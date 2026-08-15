package v1

import (
	"context"
	"os"
	"path/filepath"
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

// Attachment content used to be immutable — UpdateAttachment only ever touched metadata.
// draw.io diagrams save back over their own SVG (ADR-0017), so these tests pin down the
// four constraints that make an in-place overwrite no weaker than the upload path.

const drawioSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" ` +
	`content="&lt;mxfile&gt;&lt;/mxfile&gt;"><rect width="10" height="10"/></svg>`

func newAttachmentTestService(ctx context.Context, t *testing.T) (*APIV1Service, *store.Store) {
	t.Helper()
	ts := teststore.NewTestingStore(ctx, t)
	return &APIV1Service{Store: ts, Profile: &profile.Profile{Data: t.TempDir()}}, ts
}

func createTestUser(ctx context.Context, t *testing.T, ts *store.Store, username string, role store.Role) *store.User {
	t.Helper()
	user, err := ts.CreateUser(ctx, &store.User{
		Username:     username,
		Role:         role,
		Email:        username + "@example.com",
		Nickname:     username,
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	return user
}

func createSVGAttachment(ctx context.Context, t *testing.T, ts *store.Store, creatorID int32, locked bool) *store.Attachment {
	t.Helper()
	create := &store.Attachment{
		UID:       "diagram" + t.Name()[:1],
		CreatorID: creatorID,
		Filename:  "login-seq.svg",
		Type:      "image/svg+xml",
		Blob:      []byte(drawioSVG),
		Size:      int64(len(drawioSVG)),
	}
	if locked {
		create.Payload = &storepb.AttachmentPayload{Locked: true}
	}
	attachment, err := ts.CreateAttachment(ctx, create)
	require.NoError(t, err)
	return attachment
}

func updateContent(ctx context.Context, s *APIV1Service, name string, content []byte) (*v1pb.Attachment, error) {
	return s.UpdateAttachment(ctx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: name, Content: content},
		UpdateMask: &field_mask.FieldMask{Paths: []string{"content"}},
	})
}

func TestUpdateAttachmentContent(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	attachment := createSVGAttachment(ctx, t, ts, owner.ID, false)
	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)

	newSVG := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" ` +
		`content="&lt;mxfile&gt;v2&lt;/mxfile&gt;"><rect width="20" height="20"/></svg>`)
	updated, err := updateContent(authCtx, s, "attachments/"+attachment.UID, newSVG)
	require.NoError(t, err)
	// Size must track the bytes actually stored, or the attachment list reports a stale figure.
	require.Equal(t, int64(len(newSVG)), updated.Size)

	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{UID: &attachment.UID, GetBlob: true})
	require.NoError(t, err)
	require.Equal(t, newSVG, stored.Blob)
	require.Equal(t, int64(len(newSVG)), stored.Size)
	// The MIME type is not part of a content update and must be unchanged.
	require.Equal(t, "image/svg+xml", stored.Type)
}

func TestUpdateAttachmentContentRewritesLocalFileInPlace(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)

	// Local-storage attachments keep their bytes on disk; the overwrite must land on the
	// existing path rather than minting a new one and orphaning the old file.
	reference := "assets/login-seq.svg"
	require.NoError(t, os.MkdirAll(filepath.Join(s.Profile.Data, "assets"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(s.Profile.Data, reference), []byte(drawioSVG), 0644))
	attachment, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:         "localdiagram",
		CreatorID:   owner.ID,
		Filename:    "login-seq.svg",
		Type:        "image/svg+xml",
		Size:        int64(len(drawioSVG)),
		StorageType: storepb.AttachmentStorageType_LOCAL,
		Reference:   reference,
	})
	require.NoError(t, err)

	newSVG := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"/>`)
	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	_, err = updateContent(authCtx, s, "attachments/"+attachment.UID, newSVG)
	require.NoError(t, err)

	onDisk, err := os.ReadFile(filepath.Join(s.Profile.Data, reference))
	require.NoError(t, err)
	require.Equal(t, newSVG, onDisk)

	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{UID: &attachment.UID})
	require.NoError(t, err)
	require.Equal(t, reference, stored.Reference)
	require.Equal(t, int64(len(newSVG)), stored.Size)
}

func TestUpdateAttachmentContentRejectsNonCreator(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	stranger := createTestUser(ctx, t, ts, "stranger", store.RoleUser)
	attachment := createSVGAttachment(ctx, t, ts, owner.ID, false)

	strangerCtx := context.WithValue(ctx, auth.UserIDContextKey, stranger.ID)
	_, err := updateContent(strangerCtx, s, "attachments/"+attachment.UID, []byte(drawioSVG))
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{UID: &attachment.UID, GetBlob: true})
	require.NoError(t, err)
	require.Equal(t, []byte(drawioSVG), stored.Blob)
}

func TestUpdateAttachmentContentRejectsLocked(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	attachment := createSVGAttachment(ctx, t, ts, owner.ID, true)

	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	_, err := updateContent(authCtx, s, "attachments/"+attachment.UID, []byte(drawioSVG))
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestUpdateAttachmentContentRejectsNonSVGReplacement(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	attachment := createSVGAttachment(ctx, t, ts, owner.ID, false)
	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)

	// An SVG attachment keeps being served as image/svg+xml, so anything that isn't an SVG
	// would be a file type swap smuggled past the upload validation.
	_, err := updateContent(authCtx, s, "attachments/"+attachment.UID, []byte("#!/bin/sh\nrm -rf /\n"))
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	// Empty content is a truncation, not an update.
	_, err = updateContent(authCtx, s, "attachments/"+attachment.UID, nil)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{UID: &attachment.UID, GetBlob: true})
	require.NoError(t, err)
	require.Equal(t, []byte(drawioSVG), stored.Blob)
}

func TestUpdateAttachmentContentRejectsUnsupportedType(t *testing.T) {
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("attachment content overwrite tests run against sqlite")
	}
	ctx := context.Background()
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	attachment, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:       "photoattachment",
		CreatorID: owner.ID,
		Filename:  "photo.png",
		Type:      "image/png",
		Blob:      []byte("not really a png"),
		Size:      16,
	})
	require.NoError(t, err)

	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	_, err = updateContent(authCtx, s, "attachments/"+attachment.UID, []byte(drawioSVG))
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestLooksLikeSVG(t *testing.T) {
	require.True(t, looksLikeSVG([]byte(drawioSVG)))
	require.True(t, looksLikeSVG([]byte("<?xml version=\"1.0\"?>\n<!-- c -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>")))
	require.False(t, looksLikeSVG([]byte("#!/bin/sh\necho hi")))
	require.False(t, looksLikeSVG([]byte("<html><body><svg/></body></html>")))
	require.False(t, looksLikeSVG(nil))
}
