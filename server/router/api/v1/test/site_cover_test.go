package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestPublishFreezesCover covers the snapshot rule at its sharpest: the card
// image is decided when the snapshot is taken. Deriving it at read time would
// mean an edit of the source document silently changed what the live site shows,
// which is the one thing a snapshot exists to prevent.
func TestPublishFreezesCover(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	attachment, err := ts.Service.CreateAttachment(adminCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{Filename: "hero.png", Size: 5, Type: "image/png", Content: []byte("bytes")},
	})
	require.NoError(t, err)
	uid := attachmentUIDFromName(t, attachment.Name)

	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Title:   "Release Notes",
			Content: "![hero](/file/attachments/" + uid + "/hero.png)\n\nbody",
		},
	})
	require.NoError(t, err)

	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	listed, err := ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name})
	require.NoError(t, err)
	require.Len(t, listed.Pages, 1)
	// The cover rides on the listing, which is where cards are drawn — a card
	// that had to fetch each page's body to find its image would be fetching the
	// whole site to draw a home page.
	require.Equal(t, "/file/attachments/"+uid+"/hero.png", listed.Pages[0].CoverUrl)

	// The source document loses its image. The published card keeps it until the
	// document is published again.
	_, err = ts.Service.UpdateMemo(adminCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: memo.Name, Content: "body only"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)

	listed, err = ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name})
	require.NoError(t, err)
	require.Equal(t, "/file/attachments/"+uid+"/hero.png", listed.Pages[0].CoverUrl)

	_, err = ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	listed, err = ts.Service.ListPublicPages(ctx, &apiv1.ListPublicPagesRequest{Site: site.Name})
	require.NoError(t, err)
	require.Empty(t, listed.Pages[0].CoverUrl)
	require.Equal(t, pub.Slug, listed.Pages[0].Slug)
}

// TestPublishTakesCoverFromFrontmatterAndDropsTheRest covers both halves of the
// frontmatter rule: the whitelisted cover key is read, and the block itself does
// not leave the knowledge base — it carries status, ordering and memogit
// identity, none of which is a reader's business.
func TestPublishTakesCoverFromFrontmatterAndDropsTheRest(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	attachment, err := ts.Service.CreateAttachment(adminCtx, &apiv1.CreateAttachmentRequest{
		Attachment: &apiv1.Attachment{Filename: "card.png", Size: 5, Type: "image/png", Content: []byte("bytes")},
	})
	require.NoError(t, err)
	uid := attachmentUIDFromName(t, attachment.Name)

	content := "---\nstatus: in-process\ncover: attachments/" + uid +
		"\nmemogit-id: 0123456789\n---\n\n![inline](/file/attachments/other/x.png)\n\nbody"
	memo, err := ts.Service.CreateMemo(adminCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Handbook", Content: content},
	})
	require.NoError(t, err)

	pub, err := ts.Service.PublishMemo(adminCtx, &apiv1.PublishMemoRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)

	page, err := ts.Service.GetPublicPage(ctx, &apiv1.GetPublicPageRequest{Site: site.Name, Slug: pub.Slug})
	require.NoError(t, err)
	// The frontmatter cover wins over the body's first image.
	require.Equal(t, "/file/attachments/"+uid+"/card.png", page.CoverUrl)
	require.NotContains(t, page.Content, "memogit-id")
	require.NotContains(t, page.Content, "in-process")
	require.Contains(t, page.Content, "body")

	// The cover is a file like any other: publishing reports that a reader
	// cannot fetch it yet and changes nothing about the file itself.
	preview, err := ts.Service.PreviewPublish(adminCtx, &apiv1.PreviewPublishRequest{Parent: site.Name, Memo: memo.Name})
	require.NoError(t, err)
	filenames := make([]string, 0, len(preview.AttachmentsNotPublic))
	for _, notice := range preview.AttachmentsNotPublic {
		filenames = append(filenames, notice.Filename)
	}
	require.Contains(t, filenames, "card.png")
}
