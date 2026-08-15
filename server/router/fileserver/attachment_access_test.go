package fileserver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// The two ways to reach an attachment — the binary download at /file/attachments/...
// and the AttachmentService/GetAttachment metadata call — are supposed to answer the
// same question. They used to be two separate implementations and had drifted apart;
// this file pins the answer for the whole matrix (visibility × recycle bin × instance
// openness × viewer × share token) on both paths at once, so the next drift fails a
// test instead of leaking a file.

// outcome is what a request is expected to get back, expressed independently of the
// transport: the two paths spell the same decision as an HTTP status and a gRPC code.
type outcome int

const (
	allowed outcome = iota
	unauthenticated
	forbidden
	notFound
)

func (o outcome) httpStatus() int {
	switch o {
	case allowed:
		return http.StatusOK
	case unauthenticated:
		return http.StatusUnauthorized
	case forbidden:
		return http.StatusForbidden
	default:
		return http.StatusNotFound
	}
}

func (o outcome) grpcCode() codes.Code {
	switch o {
	case allowed:
		return codes.OK
	case unauthenticated:
		return codes.Unauthenticated
	case forbidden:
		return codes.PermissionDenied
	default:
		return codes.NotFound
	}
}

// accessFixture is one document with one attachment hanging off it, plus the cast of
// viewers used to probe it.
type accessFixture struct {
	svc   *apiv1service.APIV1Service
	fs    *FileServerService
	owner *store.User
	other *store.User
	admin *store.User
}

func newAccessFixture(ctx context.Context, t *testing.T) (*accessFixture, func()) {
	t.Helper()
	svc, fs, _, cleanup := newShareAttachmentTestServices(ctx, t)

	// owner and other share one knowledge base: "other" stands for a colleague who
	// can reach the document's library, so that what the matrix probes is the
	// document's own visibility rather than the library gate in front of it.
	owner, workspace := createMemberWithWorkspace(ctx, t, svc, "acl-owner")
	other, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "acl-other", Role: store.RoleUser, Email: "acl-other@example.com",
	})
	require.NoError(t, err)
	grantWorkspace(ctx, t, svc, workspace, other, store.WorkspaceGrantRoleEditor)
	admin, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "acl-admin", Role: store.RoleAdmin, Email: "acl-admin@example.com",
	})
	require.NoError(t, err)

	return &accessFixture{svc: svc, fs: fs, owner: owner, other: other, admin: admin}, cleanup
}

// createAttachment uploads a file owned by owner and returns it.
func (f *accessFixture) createAttachment(ctx context.Context, t *testing.T, filename string) *apiv1.Attachment {
	t.Helper()
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	attachment, err := f.svc.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{
			Filename: filename,
			Type:     "text/plain",
			Content:  []byte("attachment body"),
		},
	})
	require.NoError(t, err)
	return attachment
}

// createMemoWith creates a document owned by owner carrying the given attachment,
// optionally moved straight into the recycle bin.
func (f *accessFixture) createMemoWith(ctx context.Context, t *testing.T, attachment *apiv1.Attachment, visibility apiv1.Visibility, archived bool) *store.Memo {
	t.Helper()
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	created, err := f.svc.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:     "document body",
			Visibility:  visibility,
			Attachments: []*apiv1.Attachment{{Name: attachment.Name}},
		},
	})
	require.NoError(t, err)

	uid := created.Name[len("memos/"):]
	memo, err := f.svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.NotNil(t, memo)

	if archived {
		// Straight through the store: the API-level archive refuses documents that
		// others link to, which is beside the point here.
		archivedStatus := store.Archived
		require.NoError(t, f.svc.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archivedStatus}))
		memo.RowStatus = store.Archived
	}
	return memo
}

// viewer names one of the identities a request can arrive as. "anonymous" carries no
// credentials at all.
type viewer struct {
	name string
	user *store.User
}

func (f *accessFixture) viewers() []viewer {
	return []viewer{
		{name: "anonymous"},
		{name: "owner", user: f.owner},
		{name: "other", user: f.other},
		{name: "admin", user: f.admin},
	}
}

// getFile issues the binary download as the given viewer and returns the status code.
func (f *accessFixture) getFile(t *testing.T, attachment *apiv1.Attachment, v viewer, query string) int {
	t.Helper()
	e := echo.New()
	f.fs.RegisterRoutes(e)

	url := fmt.Sprintf("/file/%s/%s%s", attachment.Name, attachment.Filename, query)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if v.user != nil {
		token, _, err := auth.GenerateAccessTokenV2(v.user.ID, v.user.Username, string(v.user.Role), string(v.user.RowStatus), []byte(f.svc.Secret))
		require.NoError(t, err)
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

// getMetadata issues the GetAttachment RPC as the given viewer and returns its code.
func (f *accessFixture) getMetadata(ctx context.Context, t *testing.T, attachment *apiv1.Attachment, v viewer) codes.Code {
	t.Helper()
	viewerCtx := ctx
	if v.user != nil {
		viewerCtx = context.WithValue(ctx, auth.UserIDContextKey, v.user.ID)
	}
	_, err := f.svc.GetAttachment(viewerCtx, &apiv1.GetAttachmentRequest{Name: attachment.Name})
	return status.Code(err)
}

// TestAttachmentAccessMatrix walks the full decision table on both access paths.
//
// Two rules the table encodes that the pre-convergence code got wrong: a document in
// the recycle bin takes its attachments with it (only the creator still reaches them),
// and "other" — a colleague with access to the same knowledge base — parts ways with
// the owner exactly where the document's own visibility says so. The admin is the team
// owner and reads PRIVATE documents too, but the recycle bin stops even them.
func TestAttachmentAccessMatrix(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name         string
		visibility   apiv1.Visibility
		archived     bool
		openInstance bool
		// Expected outcome per viewer, in the order returned by viewers().
		anonymous, owner, other, admin outcome
	}{
		// Open instance (InstanceURL configured), documents in normal state.
		{"public/active/open", apiv1.Visibility_PUBLIC, false, true, allowed, allowed, allowed, allowed},
		{"protected/active/open", apiv1.Visibility_PROTECTED, false, true, unauthenticated, allowed, allowed, allowed},
		{"private/active/open", apiv1.Visibility_PRIVATE, false, true, unauthenticated, allowed, forbidden, allowed},

		// Private instance (no InstanceURL): even a PUBLIC document needs a viewer.
		{"public/active/private-instance", apiv1.Visibility_PUBLIC, false, false, unauthenticated, allowed, allowed, allowed},
		{"protected/active/private-instance", apiv1.Visibility_PROTECTED, false, false, unauthenticated, allowed, allowed, allowed},
		{"private/active/private-instance", apiv1.Visibility_PRIVATE, false, false, unauthenticated, allowed, forbidden, allowed},

		// Recycle bin: creator only, whatever the visibility says.
		{"public/archived/open", apiv1.Visibility_PUBLIC, true, true, notFound, allowed, notFound, notFound},
		{"protected/archived/open", apiv1.Visibility_PROTECTED, true, true, notFound, allowed, notFound, notFound},
		{"private/archived/open", apiv1.Visibility_PRIVATE, true, true, notFound, allowed, notFound, notFound},
		{"public/archived/private-instance", apiv1.Visibility_PUBLIC, true, false, notFound, allowed, notFound, notFound},
		{"protected/archived/private-instance", apiv1.Visibility_PROTECTED, true, false, notFound, allowed, notFound, notFound},
		{"private/archived/private-instance", apiv1.Visibility_PRIVATE, true, false, notFound, allowed, notFound, notFound},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, cleanup := newAccessFixture(ctx, t)
			defer cleanup()

			attachment := f.createAttachment(ctx, t, "matrix.txt")
			f.createMemoWith(ctx, t, attachment, tc.visibility, tc.archived)

			if tc.openInstance {
				f.fs.Profile.InstanceURL = "http://localhost:8080"
			} else {
				f.fs.Profile.InstanceURL = ""
			}

			want := []outcome{tc.anonymous, tc.owner, tc.other, tc.admin}
			for i, v := range f.viewers() {
				t.Run(v.name+"/file", func(t *testing.T) {
					require.Equal(t, want[i].httpStatus(), f.getFile(t, attachment, v, ""))
				})
				t.Run(v.name+"/metadata", func(t *testing.T) {
					require.Equal(t, want[i].grpcCode(), f.getMetadata(ctx, t, attachment, v))
				})
			}
		})
	}
}

// TestAttachmentAccess_Unlinked pins the case with no document to inherit from: an
// attachment that was uploaded but never attached is the uploader's alone.
func TestAttachmentAccess_Unlinked(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "unlinked.txt")

	want := map[string]outcome{
		"anonymous": unauthenticated,
		"owner":     allowed,
		"other":     forbidden,
		"admin":     forbidden,
	}
	for _, v := range f.viewers() {
		t.Run(v.name+"/file", func(t *testing.T) {
			require.Equal(t, want[v.name].httpStatus(), f.getFile(t, attachment, v, ""))
		})
		t.Run(v.name+"/metadata", func(t *testing.T) {
			require.Equal(t, want[v.name].grpcCode(), f.getMetadata(ctx, t, attachment, v))
		})
	}
}

// TestAttachmentAccess_CommentInheritsParent covers the shape the visibility cascade
// cannot fix retroactively: a comment whose stored visibility is looser than the
// document it hangs on. The attachment has to answer to both.
func TestAttachmentAccess_CommentInheritsParent(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)

	parent, err := f.svc.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "parent document", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	attachment := f.createAttachment(ctx, t, "comment.txt")
	comment, err := f.svc.CreateMemoComment(ownerCtx, &apiv1.CreateMemoCommentRequest{
		Name: parent.Name,
		Comment: &apiv1.Memo{
			Content:     "a comment",
			Visibility:  apiv1.Visibility_PUBLIC,
			Attachments: []*apiv1.Attachment{{Name: attachment.Name}},
		},
	})
	require.NoError(t, err)

	// Baseline: everything public, everyone reaches the comment's attachment.
	for _, v := range f.viewers() {
		require.Equal(t, http.StatusOK, f.getFile(t, attachment, v, ""), "viewer %s before parent is tightened", v.name)
	}

	// Tighten the parent behind the comment's back — straight through the store, so
	// the comment keeps its stale PUBLIC value the way pre-cascade data does.
	parentUID := parent.Name[len("memos/"):]
	parentMemo, err := f.svc.Store.GetMemo(ctx, &store.FindMemo{UID: &parentUID})
	require.NoError(t, err)
	private := store.Private
	require.NoError(t, f.svc.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: parentMemo.ID, Visibility: &private}))

	commentUID := comment.Name[len("memos/"):]
	commentMemo, err := f.svc.Store.GetMemo(ctx, &store.FindMemo{UID: &commentUID})
	require.NoError(t, err)
	require.Equal(t, store.Public, commentMemo.Visibility, "comment is expected to keep its stale value for this test")

	want := map[string]outcome{
		"anonymous": unauthenticated,
		"owner":     allowed,
		"other":     forbidden,
		"admin":     allowed,
	}
	for _, v := range f.viewers() {
		t.Run(v.name+"/file", func(t *testing.T) {
			require.Equal(t, want[v.name].httpStatus(), f.getFile(t, attachment, v, ""))
		})
		t.Run(v.name+"/metadata", func(t *testing.T) {
			require.Equal(t, want[v.name].grpcCode(), f.getMetadata(ctx, t, attachment, v))
		})
	}
}

// TestAttachmentAccess_ShareToken covers the token path: it stands in for an identity,
// but only for the document it was minted for, and it does not survive the recycle bin
// (the shared-document page treats an archived document as gone, so its files are too).
func TestAttachmentAccess_ShareToken(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	anonymous := viewer{name: "anonymous"}

	attachment := f.createAttachment(ctx, t, "shared.txt")
	memo := f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	share, err := f.svc.CreateMemoShare(ownerCtx, &apiv1.CreateMemoShareRequest{
		Parent:    "memos/" + memo.UID,
		MemoShare: &apiv1.MemoShare{},
	})
	require.NoError(t, err)
	token := share.Name[strings.LastIndex(share.Name, "/")+1:]

	// A second private document, untouched by that share.
	otherAttachment := f.createAttachment(ctx, t, "not-shared.txt")
	f.createMemoWith(ctx, t, otherAttachment, apiv1.Visibility_PRIVATE, false)

	require.Equal(t, http.StatusOK, f.getFile(t, attachment, anonymous, "?share_token="+token),
		"the token's own document is reachable anonymously")
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, otherAttachment, anonymous, "?share_token="+token),
		"the token must not carry over to another document")

	// Into the recycle bin: the token stops working.
	archived := store.Archived
	require.NoError(t, f.svc.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archived}))
	require.Equal(t, http.StatusNotFound, f.getFile(t, attachment, anonymous, "?share_token="+token),
		"an archived document's share token must not still serve its files")
}
