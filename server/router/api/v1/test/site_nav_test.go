package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestNavTreeHidesUnpublishedEntries is the whole point of serving the tree from
// the server rather than handing the raw configuration to the client: an entry
// pointing at a document that is not published on this site must not reach a
// reader at all. Rendering it as a dead link would be bad navigation; rendering
// its label would be a disclosure — the label alone says that document exists.
func TestNavTreeHidesUnpublishedEntries(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "body"},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	// The author writes the tree ahead of publishing, which is the normal way to
	// build one: two of these three entries have nothing behind them yet.
	updated, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site: &apiv1.Site{Name: site.Name, Nav: []*apiv1.SiteNavItem{
			{Label: "Guides", Children: []*apiv1.SiteNavItem{
				{Label: "Getting Started", Slug: pub.Slug},
				{Label: "Advanced", Slug: "advanced-draft"},
			}},
			{Label: "Internal Runbook", Slug: "runbook"},
		}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"nav"}},
	})
	require.NoError(t, err)
	// The author's own view keeps everything they wrote.
	require.Len(t, updated.Nav, 2)
	require.Len(t, updated.Nav[0].Children, 2)

	profile, err := ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Len(t, profile.Nav, 1, "a node with nothing published under it is not served")
	require.Equal(t, "Guides", profile.Nav[0].Label)
	require.Empty(t, profile.Nav[0].Slug, "a grouping node keeps grouping")
	require.Len(t, profile.Nav[0].Children, 1)
	require.Equal(t, pub.Slug, profile.Nav[0].Children[0].Slug)

	// Taking the page down empties the tree rather than leaving a link to a 404.
	_, err = ts.Service.UnpublishMemo(adminCtx, &apiv1.UnpublishMemoRequest{Name: pub.Name})
	require.NoError(t, err)
	profile, err = ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Empty(t, profile.Nav)
}

// TestNavTreeKeepsAPublishedParentWhoseChildIsNot guards the other half of the
// pruning rule: a node that points at a published page stays even when nothing
// under it survives.
func TestNavTreeKeepsAPublishedParentWhoseChildIsNot(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{Memo: &apiv1.Memo{Title: "Handbook", Content: "body"}})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site: &apiv1.Site{Name: site.Name, Nav: []*apiv1.SiteNavItem{
			{Label: "Handbook", Slug: pub.Slug, Children: []*apiv1.SiteNavItem{
				{Label: "Payroll", Slug: "payroll"},
			}},
		}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"nav"}},
	})
	require.NoError(t, err)

	profile, err := ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Len(t, profile.Nav, 1)
	require.Equal(t, pub.Slug, profile.Nav[0].Slug)
	require.Empty(t, profile.Nav[0].Children)
}

// TestNavTreeRejectsOffSiteTargets keeps the tree in-site. A nav entry is
// navigation within one site; an absolute URL would make it an outbound link
// list and a `javascript:` value would make it a script.
func TestNavTreeRejectsOffSiteTargets(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	for name, nav := range map[string][]*apiv1.SiteNavItem{
		"absolute url": {{Label: "Elsewhere", Slug: "https://evil.example/x"}},
		"script":       {{Label: "Elsewhere", Slug: "javascript:alert(1)"}},
		"path escape":  {{Label: "Elsewhere", Slug: "../../admin"}},
		"no label":     {{Label: "  ", Slug: "handbook"}},
		"nested target": {{Label: "Guides", Children: []*apiv1.SiteNavItem{
			{Label: "Elsewhere", Slug: "//evil.example"},
		}}},
	} {
		_, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
			Site:       &apiv1.Site{Name: site.Name, Nav: nav},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"nav"}},
		})
		require.Error(t, err, name)
	}
}
