package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/protobuf/field_mask"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/profile"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// The write side of Attachment.access. What it protects, in order of how badly it
// would hurt to get wrong: only the owner may publish a file (决策 9), an instance
// with no public address may not promise a public link (决策 6), and the two
// non-default modes may never both be recorded on one attachment.

func newAccessUpdateService(ctx context.Context, t *testing.T, instanceURL string) (*APIV1Service, *store.Store) {
	t.Helper()
	ts := teststore.NewTestingStore(ctx, t)
	return &APIV1Service{Store: ts, Profile: &profile.Profile{Data: t.TempDir(), InstanceURL: instanceURL}}, ts
}

func createPlainAttachment(ctx context.Context, t *testing.T, ts *store.Store, creatorID int32, uid string) *store.Attachment {
	t.Helper()
	attachment, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:       uid,
		CreatorID: creatorID,
		Filename:  "photo.png",
		Type:      "image/png",
		Blob:      []byte("bytes"),
		Size:      5,
	})
	require.NoError(t, err)
	return attachment
}

func setAccess(ctx context.Context, svc *APIV1Service, attachment *store.Attachment, access v1pb.AttachmentAccess) (*v1pb.Attachment, error) {
	return svc.UpdateAttachment(ctx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: AttachmentNamePrefix + attachment.UID, Access: access},
		UpdateMask: &field_mask.FieldMask{Paths: []string{"access"}},
	})
}

func TestUpdateAttachmentAccess_PublicIsOwnerOnly(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "https://notes.example.com")

	owner := createTestUser(ctx, t, ts, "access-owner", store.RoleUser)
	admin := createTestUser(ctx, t, ts, "access-admin", store.RoleAdmin)
	attachment := createPlainAttachment(ctx, t, ts, owner.ID, "acc-owner-only")

	// An admin may rename or delete someone else's attachment, but publishing it is
	// the owner's decision, not an administrative one.
	_, err := setAccess(context.WithValue(ctx, auth.UserIDContextKey, admin.ID), svc, attachment, v1pb.AttachmentAccess_ACCESS_PUBLIC)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	updated, err := setAccess(context.WithValue(ctx, auth.UserIDContextKey, owner.ID), svc, attachment, v1pb.AttachmentAccess_ACCESS_PUBLIC)
	require.NoError(t, err)
	require.Equal(t, v1pb.AttachmentAccess_ACCESS_PUBLIC, updated.Access)
	require.False(t, updated.Locked)
}

func TestUpdateAttachmentAccess_PublicNeedsInstanceURL(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "")

	owner := createTestUser(ctx, t, ts, "access-nourl", store.RoleUser)
	attachment := createPlainAttachment(ctx, t, ts, owner.ID, "acc-no-url")

	_, err := setAccess(context.WithValue(ctx, auth.UserIDContextKey, owner.ID), svc, attachment, v1pb.AttachmentAccess_ACCESS_PUBLIC)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestUpdateAttachmentAccess_LockedNeedsUnlockVerifier(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "https://notes.example.com")

	owner := createTestUser(ctx, t, ts, "access-lock", store.RoleUser)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	attachment := createPlainAttachment(ctx, t, ts, owner.ID, "acc-lock")

	// R8 again, now via the `access` mask rather than the retired `locked` one.
	_, err := setAccess(ownerCtx, svc, attachment, v1pb.AttachmentAccess_ACCESS_LOCKED)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))

	_, err = ts.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: owner.ID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value:  &storepb.UserSetting_SecretKey{SecretKey: &storepb.SecretKeyUserSetting{UnlockVerifier: "verifier"}},
	})
	require.NoError(t, err)

	updated, err := setAccess(ownerCtx, svc, attachment, v1pb.AttachmentAccess_ACCESS_LOCKED)
	require.NoError(t, err)
	require.Equal(t, v1pb.AttachmentAccess_ACCESS_LOCKED, updated.Access)
	require.True(t, updated.Locked, "the retired bool stays a faithful mirror for callers still reading it")
}

// Going LOCKED → PUBLIC must clear the legacy bool as it goes: the read side treats
// a leftover `locked = true` as authoritative and would keep the file private
// forever, which reads to the owner as a button that does nothing.
func TestUpdateAttachmentAccess_LockedToPublicClearsLegacyBool(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "https://notes.example.com")

	owner := createTestUser(ctx, t, ts, "access-relock", store.RoleUser)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	attachment := createPlainAttachment(ctx, t, ts, owner.ID, "acc-relock")
	_, err := ts.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: owner.ID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value:  &storepb.UserSetting_SecretKey{SecretKey: &storepb.SecretKeyUserSetting{UnlockVerifier: "verifier"}},
	})
	require.NoError(t, err)

	_, err = setAccess(ownerCtx, svc, attachment, v1pb.AttachmentAccess_ACCESS_LOCKED)
	require.NoError(t, err)
	_, err = setAccess(ownerCtx, svc, attachment, v1pb.AttachmentAccess_ACCESS_PUBLIC)
	require.NoError(t, err)

	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{UID: &attachment.UID})
	require.NoError(t, err)
	require.False(t, stored.Payload.GetLocked())
	require.Equal(t, storepb.AttachmentAccess_ACCESS_PUBLIC, stored.Payload.GetAccess())
}

// The pre-三态 "locked" field mask keeps working for clients built against it.
func TestUpdateAttachmentAccess_LegacyLockedMaskStillWorks(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "https://notes.example.com")

	owner := createTestUser(ctx, t, ts, "access-legacy", store.RoleUser)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	attachment := createPlainAttachment(ctx, t, ts, owner.ID, "acc-legacy")
	_, err := ts.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: owner.ID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value:  &storepb.UserSetting_SecretKey{SecretKey: &storepb.SecretKeyUserSetting{UnlockVerifier: "verifier"}},
	})
	require.NoError(t, err)

	updated, err := svc.UpdateAttachment(ownerCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: AttachmentNamePrefix + attachment.UID, Locked: true},
		UpdateMask: &field_mask.FieldMask{Paths: []string{"locked"}},
	})
	require.NoError(t, err)
	require.Equal(t, v1pb.AttachmentAccess_ACCESS_LOCKED, updated.Access)

	updated, err = svc.UpdateAttachment(ownerCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: AttachmentNamePrefix + attachment.UID, Locked: false},
		UpdateMask: &field_mask.FieldMask{Paths: []string{"locked"}},
	})
	require.NoError(t, err)
	require.Equal(t, v1pb.AttachmentAccess_ACCESS_INHERIT, updated.Access)
}

// The settings page that lists "which of my files are on the open internet" is built
// out of ListAttachments plus a CEL filter over the payload JSON, so the whole feature
// hangs on this one string matching how protojson actually writes the enum. A wrong
// path here fails silently — an empty list reads exactly like "nothing is public".
func TestListAttachments_FilterByPublicAccess(t *testing.T) {
	ctx := context.Background()
	svc, ts := newAccessUpdateService(ctx, t, "https://notes.example.com")

	owner := createTestUser(ctx, t, ts, "access-lister", store.RoleUser)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)

	published := createPlainAttachment(ctx, t, ts, owner.ID, "acc-list-public")
	createPlainAttachment(ctx, t, ts, owner.ID, "acc-list-inherit")
	_, err := setAccess(ownerCtx, svc, published, v1pb.AttachmentAccess_ACCESS_PUBLIC)
	require.NoError(t, err)

	resp, err := svc.ListAttachments(ownerCtx, &v1pb.ListAttachmentsRequest{Filter: `access == "ACCESS_PUBLIC"`})
	require.NoError(t, err)
	require.Len(t, resp.Attachments, 1)
	require.Equal(t, AttachmentNamePrefix+published.UID, resp.Attachments[0].Name)

	// And revoking takes it back off the list, which is the only way a user has to
	// confirm the link is actually gone.
	_, err = setAccess(ownerCtx, svc, published, v1pb.AttachmentAccess_ACCESS_INHERIT)
	require.NoError(t, err)
	resp, err = svc.ListAttachments(ownerCtx, &v1pb.ListAttachmentsRequest{Filter: `access == "ACCESS_PUBLIC"`})
	require.NoError(t, err)
	require.Empty(t, resp.Attachments)
}
