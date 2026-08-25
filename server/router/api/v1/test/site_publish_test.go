package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/attachmentacl"
	"github.com/usememos/memos/store"
)

// newTestSite stands up an ONLINE site owned by the admin.
func newTestSite(ctx context.Context, t *testing.T, ts *TestService, adminCtx context.Context, name string) *apiv1.Site {
	t.Helper()
	site, err := ts.Service.CreateSite(adminCtx, &apiv1.CreateSiteRequest{
		Site: &apiv1.Site{DisplayName: name},
	})
	require.NoError(t, err)
	site, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Status: apiv1.SiteStatus_ONLINE},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	require.NoError(t, err)
	return site
}

// TestPublishRequiresAdmin covers the permission boundary: a member may have
// full write access to a knowledge base and still not be able to push its
// contents to the open internet.
func TestPublishRequiresAdmin(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	member, err := ts.CreateRegularUser(ctx, "member")
	require.NoError(t, err)
	memberCtx := ts.CreateUserContext(ctx, member.ID)

	memo, err := ts.Service.CreateMemo(memberCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Member Doc", Content: "hello"},
	})
	require.NoError(t, err)

	_, err = ts.Service.PublishMemo(memberCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "only an admin")

	_, err = ts.Service.ListSites(memberCtx, &apiv1.ListSitesRequest{})
	require.Error(t, err)
}

// TestPublishSnapshotIsFrozen covers the core of the snapshot model: readers see
// what was published, not what the document says now, until the author
// republishes.
func TestPublishSnapshotIsFrozen(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "First Post", Content: "original body"},
	})
	require.NoError(t, err)

	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "first-post", pub.Slug)
	require.False(t, pub.Outdated)

	_, err = ts.Service.UpdateMemo(adminCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "edited body"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	// updated_ts has one-second resolution, and the edit above lands in the same
	// second as the publish. Push it forward so the staleness check has something
	// to see; a real edit arrives seconds or minutes later.
	memoUID := memoUIDFromName(t, memo.Name)
	stored, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	laterTs := stored.UpdatedTs + 1
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: stored.ID, UpdatedTs: &laterTs}))

	page, err := ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: "first-post"})
	require.NoError(t, err)
	require.Contains(t, page.Content, "original body")
	require.NotContains(t, page.Content, "edited body")

	// The editor has to be able to see that the live document moved on, or the
	// snapshot model reads as "I saved my edit and nothing happened".
	listed, err := ts.Service.ListMemoPublications(adminCtx, &apiv1.ListMemoPublicationsRequest{Parent: memo.Name})
	require.NoError(t, err)
	require.Len(t, listed.Publications, 1)
	require.True(t, listed.Publications[0].Outdated)

	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	page, err = ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: "first-post"})
	require.NoError(t, err)
	require.Contains(t, page.Content, "edited body")

	// Republishing must not move the page: the URL went out into the world the
	// moment it first went live.
	republished, err := ts.Service.ListPublications(adminCtx, &apiv1.ListPublicationsRequest{Parent: site.Name})
	require.NoError(t, err)
	require.Len(t, republished.Publications, 1)
	require.Equal(t, "first-post", republished.Publications[0].Slug)
}

// TestPublishRejectsUnpublishedReference covers the hard failure: a link to a
// page that is not on this site would land the reader on a 404.
func TestPublishRejectsUnpublishedReference(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	target, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Private Notes", Content: "internal"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)

	source, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Public Post", Content: "See [Private Notes](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)

	preview, err := ts.Service.PreviewPublish(adminCtx, &apiv1.PreviewPublishRequest{Parent: site.Name, Memo: source.Name})
	require.NoError(t, err)
	require.Len(t, preview.Blockers, 1)
	require.Equal(t, apiv1.BlockerType_UNPUBLISHED_REFERENCE, preview.Blockers[0].Type)

	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: source.Name})
	require.Error(t, err)
	// The author is told which link is at fault; "publishing failed" alone gives
	// them nothing to act on.
	require.Contains(t, err.Error(), targetUID)

	// Publishing the target first makes the link resolvable, and the snapshot
	// then points at the site's own path rather than back at the main app.
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: target.Name})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: source.Name})
	require.NoError(t, err)

	page, err := ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: "public-post"})
	require.NoError(t, err)
	require.Contains(t, page.Content, "(/private-notes)")
	require.NotContains(t, page.Content, "/memos/")
}

// TestPublishDropsSecretBlocks covers the encrypted-block rule: the snapshot must
// not carry the block at all, pointer included.
func TestPublishDropsSecretBlocks(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	content := "before\n\n```toucan-secret\nv: 1\nid: secret-record-id\nhint: prod db\n```\n\nafter"
	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Runbook", Content: content},
	})
	require.NoError(t, err)

	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	require.NotEmpty(t, pub.Slug)

	page, err := ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.NoError(t, err)
	require.NotContains(t, page.Content, "toucan-secret")
	require.NotContains(t, page.Content, "secret-record-id")
	require.Contains(t, page.Content, "before")
	require.Contains(t, page.Content, "after")
}

// TestPublicReadRequiresOnlineSite covers the site-level switch, and that it is
// the site's status alone that decides.
// TestPublicReadRequiresOnlineSite is what carries the "a site that is not
// ONLINE is indistinguishable from one that does not exist" guarantee, now that
// there is no instance-level kill switch behind it (see the launch doc, §一).
// Every method of PublicSiteService is checked, not just the page one: the
// failure this guards against is a newly added public endpoint that forgets to
// call resolveSiteForReader. Add the new endpoint here when you add one.
func TestPublicReadRequiresOnlineSite(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Hello", Content: "hi"},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	_, err = ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.NoError(t, err)

	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Status: apiv1.SiteStatus_OFFLINE},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	require.NoError(t, err)

	// Every public entry point, not only the one that serves the body: a doc id
	// or a listing that survived the site going offline leaks just as much.
	_, err = ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.Error(t, err)
	require.Contains(t, err.Error(), "site not found")

	_, err = ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "site not found")

	_, err = ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "site not found")

	_, err = ts.Service.ResolvePublicDoc(ctx, &apiv1.ResolvePublicDocRequest{Site: site.Name, DocId: memoUIDFromName(t, memo.Name)})
	require.Error(t, err)
	require.Contains(t, err.Error(), "site not found")
}

// TestShortLinkIsScopedToSite covers the probing case: a doc id must not reveal
// on one site's domain that a document exists on another.
func TestShortLinkIsScopedToSite(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	siteA := newTestSite(ctx, t, ts, adminCtx, "Site A")
	siteB := newTestSite(ctx, t, ts, adminCtx, "Site B")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Only On A", Content: "body"},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: siteA.Name, Memo: memo.Name})
	require.NoError(t, err)

	docID := memoUIDFromName(t, memo.Name)
	resolved, err := ts.Service.ResolvePublicDoc(ctx, &apiv1.ResolvePublicDocRequest{Site: siteA.Name, DocId: docID})
	require.NoError(t, err)
	require.Equal(t, pub.Slug, resolved.Slug)

	_, err = ts.Service.ResolvePublicDoc(ctx, &apiv1.ResolvePublicDocRequest{Site: siteB.Name, DocId: docID})
	require.Error(t, err)
	require.Contains(t, err.Error(), "page not found")
}

// TestSameTitleAcrossWorkspacesGetsDistinctSlugs covers the aggregation case:
// once a site collects documents from several knowledge bases, same-named
// documents will collide, and a collision must not be an error the author has to
// solve.
func TestSameTitleAcrossWorkspacesGetsDistinctSlugs(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	first, err := ts.CreateWorkspaceForUser(ctx, admin, "First KB", store.WorkspaceGrantRoleEditor)
	require.NoError(t, err)
	second, err := ts.CreateWorkspaceForUser(ctx, admin, "Second KB", store.WorkspaceGrantRoleEditor)
	require.NoError(t, err)

	memoA, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "a", Workspace: "workspaces/" + first.UID},
	})
	require.NoError(t, err)
	memoB, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Getting Started", Content: "b", Workspace: "workspaces/" + second.UID},
	})
	require.NoError(t, err)

	pubA, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memoA.Name})
	require.NoError(t, err)
	pubB, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memoB.Name})
	require.NoError(t, err)

	require.Equal(t, "getting-started", pubA.Slug)
	require.Equal(t, "getting-started-2", pubB.Slug)
}

// TestManualSlugRejectsReservedPath covers the reserved-word check: a page must
// not be able to take over the site's own search page.
func TestManualSlugRejectsReservedPath(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Anything", Content: "body"},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	_, err = ts.Service.UpdatePublication(adminCtx, &apiv1.UpdatePublicationRequest{
		Publication: &apiv1.Publication{Name: pub.Name, Slug: "search"},
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"slug"}},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "reserved")
}

// TestUnpublishTakesPageDown covers the takedown path and the dead-link warning
// the snapshot model makes necessary.
func TestUnpublishTakesPageDown(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	target, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Target", Content: "target"},
	})
	require.NoError(t, err)
	targetUID := memoUIDFromName(t, target.Name)
	targetPub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: target.Name})
	require.NoError(t, err)

	source, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Source", Content: "See [Target](/memos/" + targetUID + ")."},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: source.Name})
	require.NoError(t, err)

	result, err := ts.Service.UnpublishMemo(adminCtx, &apiv1.UnpublishMemoRequest{Name: targetPub.Name})
	require.NoError(t, err)
	require.Len(t, result.AffectedPublications, 1)
	require.Equal(t, "source", result.AffectedPublications[0].Slug)

	_, err = ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: targetPub.Slug})
	require.Error(t, err)
	require.Contains(t, err.Error(), "page not found")
}

// TestPublishLeavesAttachmentAccessAlone covers the boundary between the two
// decisions: the page going out is one act, a file going out is another. The
// pipeline reports what a reader will not be able to fetch and changes nothing.
func TestPublishLeavesAttachmentAccessAlone(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	attachment, err := ts.Service.CreateAttachment(adminCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{
			Filename: "diagram.png",
			Size:     5,
			Type:     "image/png",
			Content:  []byte("bytes"),
		},
	})
	require.NoError(t, err)
	attachmentUID := attachmentUIDFromName(t, attachment.Name)

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:   "With Image",
			Content: "![diagram](/file/attachments/" + attachmentUID + "/diagram.png)",
		},
	})
	require.NoError(t, err)

	preview, err := ts.Service.PreviewPublish(adminCtx, &apiv1.PreviewPublishRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	require.Empty(t, preview.Blockers)
	require.Len(t, preview.AttachmentsNotPublic, 1)
	require.Equal(t, "diagram.png", preview.AttachmentsNotPublic[0].Filename)

	// Publishing goes through — a page whose image is not public yet is the
	// author's business, not a reason to refuse the content.
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	stored, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	require.NoError(t, err)
	require.NotEqual(t, storepb.AttachmentAccess_ACCESS_PUBLIC, attachmentacl.EffectiveAccess(stored))
}

func attachmentUIDFromName(t *testing.T, name string) string {
	t.Helper()
	// name is "attachments/{uid}".
	const prefix = "attachments/"
	require.Greater(t, len(name), len(prefix))
	return name[len(prefix):]
}

// TestArchiveTakesPageDown covers the other half of a takedown: an author who
// puts a published document in the recycle bin has pulled it, and the site has
// to agree. The public read path only looks at publication state, so without the
// cascade the page stays up while the author believes it is gone.
func TestArchiveTakesPageDown(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Doomed", Content: "still here"},
	})
	require.NoError(t, err)
	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	page, err := ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.NoError(t, err)
	require.Equal(t, "Doomed", page.Title)

	_, err = ts.Service.UpdateMemo(adminCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, State: apiv1.State_ARCHIVED},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
	})
	require.NoError(t, err)

	_, err = ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.Error(t, err)
	require.Contains(t, err.Error(), "page not found")

	// The short link has to go down with it, not just the slug.
	_, err = ts.Service.ResolvePublicDoc(ctx, &apiv1.ResolvePublicDocRequest{Site: site.Name, DocId: page.DocId})
	require.Error(t, err)
}

// TestSiteDashboardCannotBeArchivedOrDeleted covers the pointer, not the copy:
// a site records which document is its home page, so losing that document would
// leave the site with no front door and nothing to fall back to.
// homeLayoutJSON is the smallest layout a site home page is allowed to have: a
// feed, so that pages published after the layout was frozen still show up.
const homeLayoutJSON = `{"viewType":"blog","blocks":[{"type":"public_feed","title":"Latest","tags":[]}]}`

func TestSiteDashboardCannotBeArchivedOrDeleted(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	// A home page is a `.blogview` document — an article has a page of its own,
	// so pointing the site root at one would give it two URLs and no layout.
	home, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Home", Content: homeLayoutJSON, DocType: apiv1.Memo_BLOGVIEW},
	})
	require.NoError(t, err)
	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Dashboard: home.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"dashboard"}},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateMemo(adminCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: home.Name, State: apiv1.State_ARCHIVED},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "home page")

	_, err = ts.Service.DeleteMemo(adminCtx, &apiv1.DeleteMemoRequest{Name: home.Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "home page")
}

// TestLayoutDocTypesStayOnTheirOwnSide is the whole point of splitting
// `.blogview` off `.view`: each type has exactly one route out of the knowledge
// base, and it is not the other one's. A `.view` composes live library data —
// folders, frontmatter properties — so it must never become a site's front
// door; a `.blogview` composes publication snapshots, so it must never be
// published as a page, where its block JSON would become a page body.
func TestLayoutDocTypesStayOnTheirOwnSide(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	view, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Library view", Content: "{}", DocType: apiv1.Memo_VIEW},
	})
	require.NoError(t, err)
	blogView, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Front page", Content: "{}", DocType: apiv1.Memo_BLOGVIEW},
	})
	require.NoError(t, err)

	// A library view cannot be a site's home page.
	_, err = ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Dashboard: view.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"dashboard"}},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "site home document")

	// Neither layout type can be published as a page.
	for _, memo := range []string{view.Name, blogView.Name} {
		_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo})
		require.Error(t, err, "publishing %s as a page must be refused", memo)
	}
}

// TestPublishedTagsComeFromFrontmatter pins the tag source. A site's galleries
// and feeds filter on these, so where they come from is a product decision, not
// an implementation detail: they are the author's `tags:` list, and body `#tag`
// markers — a paused knowledge-base feature — have no say.
func TestPublishedTagsComeFromFrontmatter(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:   "Hello",
			Content: "---\ntags: [guide, release]\n---\nbody with a #body-tag in it",
		},
	})
	require.NoError(t, err)
	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	listed, err := ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name})
	require.NoError(t, err)
	require.Len(t, listed.Pages, 1)
	require.Equal(t, []string{"guide", "release"}, listed.Pages[0].Tags)

	// The tag filter answers on the frontmatter list, and not on the body marker.
	matched, err := ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name, Tags: []string{"guide"}})
	require.NoError(t, err)
	require.Len(t, matched.Pages, 1)

	missed, err := ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name, Tags: []string{"body-tag"}})
	require.NoError(t, err)
	require.Empty(t, missed.Pages)
}

// TestHomePageMustCarryAFeed pins the "no dead end" rule. A home page made only
// of prose and curated galleries is frozen at the moment it is saved: every page
// published afterwards would be reachable by URL alone. The feed is the block
// that keeps listing what is new, so the site refuses a layout without one.
// A home page carrying no feed is accepted. It once was not: with the front
// door being the only listing, a curated page of markdown and galleries meant
// everything published afterwards was reachable by URL alone. The top menu's
// Latest and Archive tabs are that listing now, and they are built from the
// published pages rather than from the home layout — so the author gets to make
// a front page that is only what they arranged.
func TestHomePageNeedsNoFeed(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	feedless, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:   "Front",
			Content: `{"viewType":"blog","blocks":[{"type":"markdown","content":"# Hello"}]}`,
			DocType: apiv1.Memo_BLOGVIEW,
		},
	})
	require.NoError(t, err)

	updated, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site:       &apiv1.Site{Name: site.Name, Dashboard: feedless.Name},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"dashboard"}},
	})
	require.NoError(t, err)
	require.Equal(t, feedless.Name, updated.Dashboard)
}
