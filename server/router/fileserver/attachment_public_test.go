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

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// setAttachmentAccess writes payload.access straight through the store. The API-level
// write path has guards of its own (owner-only for PUBLIC, R8 for LOCKED) which are
// tested separately; these tests are about what the *read* side does with the value.
func setAttachmentAccess(ctx context.Context, t *testing.T, f *accessFixture, attachment *apiv1.Attachment, access storepb.AttachmentAccess) {
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
	payload.Access = access
	payload.Locked = access == storepb.AttachmentAccess_ACCESS_LOCKED
	require.NoError(t, f.svc.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: stored.ID, Payload: payload}))
}

// TestAttachmentAccess_Public pins 决策 6/7/8: a public attachment escapes the
// document's visibility but not the recycle bin, not the instance-wide anonymous
// gate, and not onto the metadata path.
func TestAttachmentAccess_Public(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name         string
		visibility   apiv1.Visibility
		archived     bool
		openInstance bool
		// What an anonymous visitor gets on the binary path, and on the metadata one.
		anonymousFile outcome
		anonymousMeta codes.Code
	}{
		// The point of the feature: a private document's file, readable by a stranger.
		{"private/active/open", apiv1.Visibility_PRIVATE, false, true, allowed, codes.Unauthenticated},
		{"protected/active/open", apiv1.Visibility_PROTECTED, false, true, allowed, codes.Unauthenticated},
		{"public/active/open", apiv1.Visibility_PUBLIC, false, true, allowed, codes.OK},

		// 决策 7: the recycle bin still wins, so deleting a document really does stop
		// serving its files.
		{"private/archived/open", apiv1.Visibility_PRIVATE, true, true, notFound, codes.NotFound},
		{"public/archived/open", apiv1.Visibility_PUBLIC, true, true, notFound, codes.NotFound},

		// 决策 6: public does not punch through the instance-wide anonymous gate. With
		// no instance URL there is no public link to hand out in the first place.
		{"private/active/private-instance", apiv1.Visibility_PRIVATE, false, false, unauthenticated, codes.Unauthenticated},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, cleanup := newAccessFixture(ctx, t)
			defer cleanup()

			attachment := f.createAttachment(ctx, t, "public.txt")
			f.createMemoWith(ctx, t, attachment, tc.visibility, tc.archived)
			setAttachmentAccess(ctx, t, f, attachment, storepb.AttachmentAccess_ACCESS_PUBLIC)

			if tc.openInstance {
				f.fs.Profile.InstanceURL = "http://localhost:8080"
			} else {
				f.fs.Profile.InstanceURL = ""
			}

			anonymous := f.viewers()[0]
			require.Equal(t, tc.anonymousFile.httpStatus(), f.getFile(t, attachment, anonymous, ""))

			// 决策 8: the bytes are public, the record is not. Metadata carries the
			// `memo` this file hangs on, and a public image is not a licence to
			// enumerate the private document holding it — so the metadata answer is
			// whatever it would have been without the public flag.
			require.Equal(t, tc.anonymousMeta, f.getMetadata(ctx, t, attachment, anonymous))

			// The owner keeps their own access either way.
			require.Equal(t, http.StatusOK, f.getFile(t, attachment, f.viewers()[1], ""))
		})
	}
}

// TestAttachmentAccess_PublicUnlinked covers the attachment that was made public
// before it was ever attached to a document: no document to inherit from, and no
// recycle bin to fall into.
func TestAttachmentAccess_PublicUnlinked(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()
	f.fs.Profile.InstanceURL = "http://localhost:8080"

	attachment := f.createAttachment(ctx, t, "unlinked-public.txt")
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, attachment, f.viewers()[0], ""))

	setAttachmentAccess(ctx, t, f, attachment, storepb.AttachmentAccess_ACCESS_PUBLIC)
	require.Equal(t, http.StatusOK, f.getFile(t, attachment, f.viewers()[0], ""))
}

// TestAttachmentAccess_LockedBeatsPublic pins the branch order. The two states are
// mutually exclusive at the API layer, so this only ever fires for data written
// around it — and when it does, the answer must be "locked".
func TestAttachmentAccess_LockedBeatsPublic(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()
	f.fs.Profile.InstanceURL = "http://localhost:8080"

	attachment := f.createAttachment(ctx, t, "contradiction.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PUBLIC, false)
	setAttachmentAccess(ctx, t, f, attachment, storepb.AttachmentAccess_ACCESS_LOCKED)
	// Mirror the state the legacy bool could describe but the enum cannot: locked
	// through `locked`, public through `access`.
	setLegacyLockedWithAccess(ctx, t, f, attachment, storepb.AttachmentAccess_ACCESS_PUBLIC)

	// Anonymous is turned away for want of an identity, and the owner for want of a
	// vault cookie — neither gets the public treatment the `access` field asks for.
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, attachment, f.viewers()[0], ""))
	require.Equal(t, http.StatusForbidden, f.getFile(t, attachment, f.viewers()[1], ""))
}

func setLegacyLockedWithAccess(ctx context.Context, t *testing.T, f *accessFixture, attachment *apiv1.Attachment, access storepb.AttachmentAccess) {
	t.Helper()
	uid, err := apiv1service.ExtractAttachmentUIDFromName(attachment.Name)
	require.NoError(t, err)
	stored, err := f.svc.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	require.NoError(t, err)
	stored.Payload.Locked = true
	stored.Payload.Access = access
	require.NoError(t, f.svc.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: stored.ID, Payload: stored.Payload}))
}

func accessTokenFor(t *testing.T, f *accessFixture, v viewer) string {
	t.Helper()
	token, _, err := auth.GenerateAccessTokenV2(v.user.ID, v.user.Username, string(v.user.Role), string(v.user.RowStatus), []byte(f.svc.Secret))
	require.NoError(t, err)
	return token
}

// TestAttachmentCacheScope pins which responses a shared cache may keep. `public`
// is only ever advertised when the read decision was reached without knowing who
// the viewer is; a locked attachment is not stored at all.
func TestAttachmentCacheScope(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name       string
		visibility apiv1.Visibility
		access     storepb.AttachmentAccess
		asOwner    bool
		want       string
	}{
		{"public-document-anonymous", apiv1.Visibility_PUBLIC, storepb.AttachmentAccess_ACCESS_INHERIT, false, "public, max-age=3600"},
		{"private-document-owner", apiv1.Visibility_PRIVATE, storepb.AttachmentAccess_ACCESS_INHERIT, true, "private, max-age=3600"},
		{"public-attachment-anonymous", apiv1.Visibility_PRIVATE, storepb.AttachmentAccess_ACCESS_PUBLIC, false, "public, max-age=3600"},
		{"locked-attachment-owner", apiv1.Visibility_PRIVATE, storepb.AttachmentAccess_ACCESS_LOCKED, true, "private, no-store"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, cleanup := newAccessFixture(ctx, t)
			defer cleanup()
			f.fs.Profile.InstanceURL = "http://localhost:8080"

			attachment := f.createAttachment(ctx, t, "cache.txt")
			f.createMemoWith(ctx, t, attachment, tc.visibility, false)
			if tc.access != storepb.AttachmentAccess_ACCESS_INHERIT {
				setAttachmentAccess(ctx, t, f, attachment, tc.access)
			}

			v := f.viewers()[0]
			cookie := ""
			if tc.asOwner {
				v = f.viewers()[1]
			}
			if tc.access == storepb.AttachmentAccess_ACCESS_LOCKED {
				setOwnerUnlockVerifier(ctx, t, f, "verifier")
				cookie = vaultCookieHeader(t, f.svc.Secret, f.owner.ID)
			}

			e := echo.New()
			f.fs.RegisterRoutes(e)
			req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/file/%s/%s", attachment.Name, attachment.Filename), nil)
			if v.user != nil {
				req.Header.Set(echo.HeaderAuthorization, "Bearer "+accessTokenFor(t, f, v))
			}
			if cookie != "" {
				req.Header.Set("Cookie", cookie)
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusOK, rec.Code)
			require.Equal(t, tc.want, rec.Header().Get("Cache-Control"))
		})
	}
}
