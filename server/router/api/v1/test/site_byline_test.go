package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestBylineIsSiteConfigurationNotAnAccount is the rule the whole field exists
// for: what a reader is told about who wrote a page is written by the author in
// the site settings, and is never derived from the account that published it.
// A login name is half of a credential pair, and in a team the byline would
// otherwise follow whoever happened to click "publish".
func TestBylineIsSiteConfigurationNotAnAccount(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "JimmyBlog")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "What skills do modern programmers need?", Content: "body"},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	// Nothing set: the site signs its own pages. This is what every site
	// published before the field existed keeps doing.
	profile, err := ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Equal(t, "JimmyBlog", profile.AuthorName)
	require.NotEqual(t, admin.Username, profile.AuthorName, "the publisher's account never reaches a reader")

	updated, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, AuthorName: "  Jimmy Zhao  "},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"author_name"}},
	})
	require.NoError(t, err)
	require.Equal(t, "Jimmy Zhao", updated.AuthorName, "surrounding whitespace is not part of a name")

	profile, err = ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Equal(t, "Jimmy Zhao", profile.AuthorName)

	// Clearing it is a real edit, not a no-op: it is how an author goes back to
	// signing with the site's name.
	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, AuthorName: ""},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"author_name"}},
	})
	require.NoError(t, err)
	profile, err = ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Equal(t, "JimmyBlog", profile.AuthorName)
}
