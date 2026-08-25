package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestSearchMatchesSnapshotBody covers the reason search runs on the server at
// all: the feed carries no bodies, so a client-side filter would search titles
// only and quietly miss the article the reader is looking for.
func TestSearchMatchesSnapshotBody(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "Install the widget first."},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	response, err := ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: "widget"})
	require.NoError(t, err)
	require.Len(t, response.Pages, 1)
	require.Equal(t, pub.Slug, response.Pages[0].Slug)
	require.Empty(t, response.Pages[0].Content, "a result list is not a way to read the whole site")

	// Every term must match, so an extra word narrows rather than widens.
	response, err = ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: "widget missing"})
	require.NoError(t, err)
	require.Empty(t, response.Pages)
}

// TestSearchNeverReachesPastThePublishedSnapshot is the disclosure guard. An
// unpublished document is not in the query range, and a published one is matched
// against the frozen snapshot — so text the author wrote after publishing cannot
// surface the article either.
func TestSearchNeverReachesPastThePublishedSnapshot(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	draft, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Compensation", Content: "The salary bands are secret."},
	})
	require.NoError(t, err)
	require.NotEmpty(t, draft.Name)

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Handbook", Content: "Public part."},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	// The author keeps editing after publishing. The snapshot does not follow.
	_, err = ts.Service.UpdateMemo(adminCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "Public part. The salary bands are secret."},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)

	response, err := ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: "salary"})
	require.NoError(t, err)
	require.Empty(t, response.Pages, "neither an unpublished document nor a post-publish edit may be searchable")
}

// TestSearchTreatsWildcardsAsText: the query goes into a LIKE pattern, so "%"
// would otherwise match every page and turn search into a full dump.
func TestSearchTreatsWildcardsAsText(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "Install the widget first."},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	for _, query := range []string{"%", "_"} {
		response, err := ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: query})
		require.NoError(t, err)
		require.Empty(t, response.Pages, "wildcard %q must be matched literally", query)
	}

	// An empty query is a mistake, not "everything".
	_, err = ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: "   "})
	require.Error(t, err)
}

// TestSearchRefusesAnOfflineSite: an offline site stays indistinguishable from
// one that does not exist, on this path too.
func TestSearchRefusesAnOfflineSite(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "Install the widget first."},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Status: apiv1.SiteStatus_OFFLINE},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	require.NoError(t, err)

	_, err = ts.Service.SearchPublicPages(ctx, &apiv1.SearchPublicPagesRequest{Site: site.Name, Query: "widget"})
	require.Error(t, err)
}
