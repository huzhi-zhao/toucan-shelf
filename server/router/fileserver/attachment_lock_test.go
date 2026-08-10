package fileserver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/util"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// lockAttachment flips payload.locked directly through the store, standing in for
// what UpdateAttachment's "locked" field mask does at the API layer — these tests
// are about the read side, so setup goes straight to the data the read side sees.
func lockAttachment(ctx context.Context, t *testing.T, f *accessFixture, attachment *v1pb.Attachment) {
	t.Helper()
	uid, err := apiv1service.ExtractAttachmentUIDFromName(attachment.Name)
	require.NoError(t, err)
	stored, err := f.svc.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	require.NoError(t, err)
	require.NotNil(t, stored)
	payload := stored.Payload
	if payload == nil {
		payload = &storepb.AttachmentPayload{}
	}
	payload.Locked = true
	require.NoError(t, f.svc.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: stored.ID, Payload: payload}))
}

func setOwnerUnlockVerifier(ctx context.Context, t *testing.T, f *accessFixture, verifier string) {
	t.Helper()
	_, err := f.svc.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: f.owner.ID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value: &storepb.UserSetting_SecretKey{
			SecretKey: &storepb.SecretKeyUserSetting{UnlockVerifier: verifier},
		},
	})
	require.NoError(t, err)
}

func vaultCookieHeader(t *testing.T, secret string, userID int32) string {
	t.Helper()
	token, _, err := auth.GenerateVaultToken(userID, []byte(secret))
	require.NoError(t, err)
	return auth.VaultCookieName + "=" + token
}

func (f *accessFixture) getFileWithCookie(t *testing.T, attachment *v1pb.Attachment, v viewer, cookieHeader string) int {
	t.Helper()
	e := echo.New()
	f.fs.RegisterRoutes(e)

	url := fmt.Sprintf("/file/%s/%s", attachment.Name, attachment.Filename)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if v.user != nil {
		token, _, err := auth.GenerateAccessTokenV2(v.user.ID, v.user.Username, string(v.user.Role), string(v.user.RowStatus), []byte(f.svc.Secret))
		require.NoError(t, err)
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	if cookieHeader != "" {
		req.Header.Set("Cookie", cookieHeader)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func (f *accessFixture) getMetadataWithCookie(ctx context.Context, t *testing.T, attachment *v1pb.Attachment, v viewer, cookieHeader string) codes.Code {
	t.Helper()
	viewerCtx := ctx
	if v.user != nil {
		viewerCtx = context.WithValue(ctx, auth.UserIDContextKey, v.user.ID)
	}
	viewerCtx = auth.SetCredentialKindInContext(viewerCtx, auth.CredentialKindSession)
	if cookieHeader != "" {
		viewerCtx = metadata.NewIncomingContext(viewerCtx, metadata.Pairs("cookie", cookieHeader))
	}
	_, err := f.svc.GetAttachment(viewerCtx, &v1pb.GetAttachmentRequest{Name: attachment.Name})
	return status.Code(err)
}

// TestAttachmentAccess_Locked pins P3's read-side rule: a locked attachment
// answers to nobody but its creator, and only over a valid vault cookie scoped
// to that exact user — not anonymous, not another user, not an admin, and not
// even the creator without the cookie.
func TestAttachmentAccess_Locked(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "locked.txt")
	lockAttachment(ctx, t, f, attachment)
	setOwnerUnlockVerifier(ctx, t, f, "correct-verifier")

	validCookie := vaultCookieHeader(t, f.svc.Secret, f.owner.ID)
	wrongSubjectCookie := vaultCookieHeader(t, f.svc.Secret, f.other.ID)
	viewers := f.viewers() // [anonymous, owner, other, admin]

	cases := []struct {
		name   string
		v      viewer
		cookie string
		file   int
		grpc   codes.Code
	}{
		{"anonymous/no-cookie", viewers[0], "", http.StatusUnauthorized, codes.Unauthenticated},
		{"other/no-cookie", viewers[2], "", http.StatusForbidden, codes.PermissionDenied},
		{"admin/no-cookie", viewers[3], "", http.StatusForbidden, codes.PermissionDenied},
		{"owner/no-cookie", viewers[1], "", http.StatusForbidden, codes.PermissionDenied},
		{"owner/cookie-for-a-different-user", viewers[1], wrongSubjectCookie, http.StatusForbidden, codes.PermissionDenied},
		{"other/owners-valid-cookie", viewers[2], validCookie, http.StatusForbidden, codes.PermissionDenied},
		{"owner/valid-cookie", viewers[1], validCookie, http.StatusOK, codes.OK},
	}

	for _, tc := range cases {
		t.Run(tc.name+"/file", func(t *testing.T) {
			require.Equal(t, tc.file, f.getFileWithCookie(t, attachment, tc.v, tc.cookie))
		})
		t.Run(tc.name+"/metadata", func(t *testing.T) {
			require.Equal(t, tc.grpc, f.getMetadataWithCookie(ctx, t, attachment, tc.v, tc.cookie))
		})
	}
}

// TestAttachmentAccess_LockedRequiresSessionCredential covers ADR-0003: a PAT
// carries the owner's own identity, so without this check it would sail through
// the creator-ID check above. The vault cookie must not be honored for it.
func TestAttachmentAccess_LockedRequiresSessionCredential(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "locked-pat.txt")
	lockAttachment(ctx, t, f, attachment)
	setOwnerUnlockVerifier(ctx, t, f, "correct-verifier")
	cookie := vaultCookieHeader(t, f.svc.Secret, f.owner.ID)

	patToken := auth.GeneratePersonalAccessToken()
	require.NoError(t, f.svc.Store.AddUserPersonalAccessToken(ctx, f.owner.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{
		TokenId:   util.GenUUID(),
		TokenHash: auth.HashPersonalAccessToken(patToken),
		CreatedAt: timestamppb.Now(),
	}))

	e := echo.New()
	f.fs.RegisterRoutes(e)
	url := fmt.Sprintf("/file/%s/%s", attachment.Name, attachment.Filename)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set(echo.HeaderAuthorization, "Bearer "+patToken)
	req.Header.Set("Cookie", cookie)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code)
}
