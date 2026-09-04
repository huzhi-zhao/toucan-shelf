package fileserver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	apiv1service "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// downloadQuery builds the query string a minted URL carries, for a token issued
// to userID for attachmentUID.
func downloadQuery(t *testing.T, secret string, userID int32, attachmentUID string) string {
	t.Helper()
	token, _, err := auth.GenerateDownloadToken(userID, attachmentUID, []byte(secret))
	require.NoError(t, err)
	return "?" + auth.DownloadTokenQueryParam + "=" + url.QueryEscape(token)
}

func attachmentUID(t *testing.T, attachment *apiv1.Attachment) string {
	t.Helper()
	uid, err := apiv1service.ExtractAttachmentUIDFromName(attachment.Name)
	require.NoError(t, err)
	return uid
}

// A download token stands in for its subject's identity on the one attachment it
// names. It is the whole point of the feature: the fetching client holds no
// session and no token of its own.
func TestDownloadTokenServesTheAttachmentItNames(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "notes.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	query := downloadQuery(t, f.svc.Secret, f.owner.ID, attachmentUID(t, attachment))
	require.Equal(t, http.StatusOK, f.getFile(t, attachment, viewer{name: "anonymous"}, query))

	// Without it, the same anonymous request gets nothing.
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, attachment, viewer{name: "anonymous"}, ""))
}

// The token authorizes one file. If it were honoured for any other, one legitimate
// download would become a key to every attachment on the instance.
func TestDownloadTokenIsBoundToOneAttachment(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	granted := f.createAttachment(ctx, t, "granted.txt")
	other := f.createAttachment(ctx, t, "other.txt")
	f.createMemoWith(ctx, t, granted, apiv1.Visibility_PRIVATE, false)
	f.createMemoWith(ctx, t, other, apiv1.Visibility_PRIVATE, false)

	query := downloadQuery(t, f.svc.Secret, f.owner.ID, attachmentUID(t, granted))
	require.Equal(t, http.StatusOK, f.getFile(t, granted, viewer{name: "anonymous"}, query))
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, other, viewer{name: "anonymous"}, query))
}

// outsider is a user with no access to the fixture's knowledge base. The
// fixture's "other" is a member of it and legitimately reads private documents
// there, so it cannot stand in for someone who should be refused.
func outsider(ctx context.Context, t *testing.T, f *accessFixture) *store.User {
	t.Helper()
	user, err := f.svc.Store.CreateUser(ctx, &store.User{
		Username: "acl-outsider", Role: store.RoleUser, Email: "acl-outsider@example.com",
	})
	require.NoError(t, err)
	return user
}

// The token says which file may be asked about, never that the answer is yes:
// the subject's ordinary read check still runs. Minting one for someone who
// cannot read the document buys them nothing — which is also what makes access
// revoked after the URL was handed out take effect immediately.
//
// The refusal is a 404, not a 403: a document in a knowledge base the viewer
// cannot see reports as missing, and holding a token for it must not turn that
// into a confirmation that it exists.
func TestDownloadTokenStillRunsTheAccessCheck(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "private.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	query := downloadQuery(t, f.svc.Secret, outsider(ctx, t, f).ID, attachmentUID(t, attachment))
	require.Equal(t, http.StatusNotFound, f.getFile(t, attachment, viewer{name: "anonymous"}, query))
}

// A recycled document hides its attachments from everyone outside the knowledge
// base, and reports them as missing rather than refused. A token for such a
// viewer must not change either half of that.
func TestDownloadTokenDoesNotResurrectRecycledDocuments(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "gone.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, true)

	query := downloadQuery(t, f.svc.Secret, outsider(ctx, t, f).ID, attachmentUID(t, attachment))
	require.Equal(t, http.StatusNotFound, f.getFile(t, attachment, viewer{name: "anonymous"}, query))
}

// A vault-locked attachment answers only to a browser session that has unlocked it.
// A download token is not a browser session and must not become a way around that.
func TestDownloadTokenCannotOpenTheVault(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "secret.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)
	lockAttachment(ctx, t, f, attachment)

	query := downloadQuery(t, f.svc.Secret, f.owner.ID, attachmentUID(t, attachment))
	require.Equal(t, http.StatusForbidden, f.getFile(t, attachment, viewer{name: "anonymous"}, query))
}

// A token signed with anything but the instance secret is not a token.
func TestDownloadTokenRejectsForgeries(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "notes.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	forged := downloadQuery(t, "not-the-instance-secret", f.owner.ID, attachmentUID(t, attachment))
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, attachment, viewer{name: "anonymous"}, forged))

	garbage := "?" + auth.DownloadTokenQueryParam + "=not-a-jwt"
	require.Equal(t, http.StatusUnauthorized, f.getFile(t, attachment, viewer{name: "anonymous"}, garbage))
}

// The whole loop the feature exists for: mint a URL through the API, then fetch
// it the way a client with no credentials of its own would. The two halves live
// in different packages and are easy to drift apart, so they are pinned together
// here rather than each against its own idea of the other.
func TestDownloadUrlIsFetchableEndToEnd(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()
	f.svc.Profile.InstanceURL = "https://kb.example.test"

	attachment := f.createAttachment(ctx, t, "report.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	// Addressed the way the app's "copy markdown reference" puts it on the
	// clipboard, which is what a user actually pastes.
	resp, err := f.svc.GetDownloadUrl(ownerCtx, &apiv1.GetDownloadUrlRequest{
		Attachment: fmt.Sprintf("![%s](/file/%s/%s)", attachment.Filename, attachment.Name, attachment.Filename),
	})
	require.NoError(t, err)
	require.Equal(t, attachment.Name, resp.Name)
	require.Equal(t, attachment.Filename, resp.Filename)
	require.True(t, resp.ExpireTime.AsTime().After(time.Now()))

	parsed, err := url.Parse(resp.Url)
	require.NoError(t, err)
	require.Equal(t, "https://kb.example.test", parsed.Scheme+"://"+parsed.Host)
	require.NotEmpty(t, parsed.Query().Get(auth.DownloadTokenQueryParam))

	e := echo.New()
	f.fs.RegisterRoutes(e)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, parsed.RequestURI(), nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "attachment body", rec.Body.String())
}

// A format an agent cannot open is refused at minting time, with no URL issued:
// handing one out would spend a fetch to arrive at bytes nothing can read.
func TestDownloadUrlRefusesUnreadableFormats(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()
	f.svc.Profile.InstanceURL = "https://kb.example.test"

	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	attachment, err := f.svc.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{
			Filename: "deck.pptx",
			Type:     "application/vnd.openxmlformats-officedocument.presentationml.presentation",
			Content:  []byte("binary"),
		},
	})
	require.NoError(t, err)
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	_, err = f.svc.GetDownloadUrl(ownerCtx, &apiv1.GetDownloadUrlRequest{Attachment: attachment.Name})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

// A vault-locked attachment is refused before any URL exists, and the refusal
// says why — a caller that only sees "permission denied" cannot tell its user
// that unlocking the vault in a browser is the way through.
func TestDownloadUrlExplainsLockedAttachments(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()
	f.svc.Profile.InstanceURL = "https://kb.example.test"

	attachment := f.createAttachment(ctx, t, "secret.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)
	lockAttachment(ctx, t, f, attachment)

	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, f.owner.ID)
	_, err := f.svc.GetDownloadUrl(ownerCtx, &apiv1.GetDownloadUrlRequest{Attachment: attachment.Name})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
	require.Contains(t, status.Convert(err).Message(), "vault")
}

// Bytes fetched with a download token are one viewer's to see, so no shared cache
// may keep a copy of them.
func TestDownloadTokenResponseIsPrivatelyCached(t *testing.T) {
	ctx := context.Background()
	f, cleanup := newAccessFixture(ctx, t)
	defer cleanup()

	attachment := f.createAttachment(ctx, t, "notes.txt")
	f.createMemoWith(ctx, t, attachment, apiv1.Visibility_PRIVATE, false)

	e := echo.New()
	f.fs.RegisterRoutes(e)
	query := downloadQuery(t, f.svc.Secret, f.owner.ID, attachmentUID(t, attachment))
	req := httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/file/%s/%s%s", attachment.Name, attachment.Filename, query), nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Header().Get(echo.HeaderCacheControl), "private")
}
