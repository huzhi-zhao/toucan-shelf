package v1

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/linkindex"
	"github.com/usememos/memos/internal/markdown"
	"github.com/usememos/memos/internal/publish"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/attachmentacl"
	"github.com/usememos/memos/store"
)

// snapshotSummaryLength caps the summary stored with a snapshot. It is what the
// site's listings show under each title.
const snapshotSummaryLength = 200

// publishPlan is what the pipeline produces before anything is written: the
// snapshot body, the references it froze, and every reason it must not go out.
// Preview and publish run the exact same pipeline — there is no "checked once on
// first publish" shortcut, because the body keeps changing after a publish
// (editor, memogit push, MCP agent) and each of those edits can drag a new
// unpublished reference or private attachment along with it.
type publishPlan struct {
	memo    *store.Memo
	content string
	title   string
	summary string
	tags    []string

	// links are the in-site document links frozen into the snapshot.
	links []*store.SitePublicationLink
	// attachmentsNotPublic are attachments the page pulls in that an anonymous
	// reader cannot fetch yet. They are reported, never acted on: publishing
	// moves content, and opening a file to the world stays a separate decision
	// made by whoever owns the file.
	attachmentsNotPublic []*store.Attachment
	// attachmentsPublic are the ones a reader can already fetch.
	attachmentsPublic []*store.Attachment
	// blockers are the hard failures. A non-empty list means nothing is written.
	blockers []*v1pb.PublishBlocker

	secretBlocksRemoved int32
	proposedSlug        string
}

func (p *publishPlan) allAttachments() []*store.Attachment {
	all := make([]*store.Attachment, 0, len(p.attachmentsNotPublic)+len(p.attachmentsPublic))
	all = append(all, p.attachmentsPublic...)
	all = append(all, p.attachmentsNotPublic...)
	return all
}

// buildPublishPlan runs the publish pipeline for one document against one site.
//
// Every read here goes through the publisher's own permission context, never a
// super-user one. That is the single constraint in this feature that is
// expensive to retrofit: the day publishing opens up to members, an
// over-privileged read inside the pipeline has nowhere to be caught.
func (s *APIV1Service) buildPublishPlan(ctx context.Context, user *store.User, site *store.Site, memo *store.Memo) (*publishPlan, error) {
	role, err := s.resolveWorkspaceAccess(ctx, user, memo.WorkspaceID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve workspace access: %v", err)
	}
	if !role.CanRead() {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if memo.RowStatus == store.Archived {
		return nil, status.Errorf(codes.FailedPrecondition, "an archived document cannot be published")
	}

	plan := &publishPlan{memo: memo, title: memo.Title}

	// 1. Drop the secret blocks first, so nothing downstream can see even the
	// pointer they carry.
	body, removed := publish.StripSecretBlocks(memo.Content)
	plan.secretBlocksRemoved = int32(removed)

	// 2. Resolve every in-site document link against the source document's own
	// knowledge base. A root-relative path is unique only within one workspace,
	// so once a site aggregates several, the same path can name two different
	// documents; the source document's workspace is what disambiguates.
	linkRefs, err := s.MarkdownService.ExtractLinks([]byte(body))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to parse document links: %v", err)
	}
	imageRefs, err := s.MarkdownService.ExtractImages([]byte(body))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to parse document images: %v", err)
	}

	hrefToSlug := map[string]string{}
	seenTargets := map[int32]bool{}
	var (
		tree      []*linkindex.TreeNode
		uidToID   map[string]int32
		treeBuilt bool
	)
	for _, ref := range linkRefs {
		if _, isAttachment := publish.ParseAttachmentUID(ref.Href); isAttachment {
			continue
		}
		uid, ok := linkindex.ResolveAbsoluteMemoHref(ref.Href)
		if !ok {
			if !linkindex.IsRootRelativeDocHref(ref.Href) {
				continue
			}
			if !treeBuilt {
				tree, uidToID, err = s.buildWorkspaceLinkTree(ctx, memo.WorkspaceID)
				if err != nil {
					return nil, status.Errorf(codes.Internal, "failed to build link tree: %v", err)
				}
				treeBuilt = true
			}
			// The in-app renderer falls back to matching a title anywhere in the
			// tree when a path misses. That fallback stays off here: it would
			// happily land on an unpublished document, which makes it a
			// disclosure path rather than a convenience.
			uid, ok = linkindex.ResolveRootRelativePath(tree, ref.Href)
			if !ok {
				continue
			}
		}

		targetID, ok := uidToID[uid]
		if !ok {
			target, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeContent: true})
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to get linked document: %v", err)
			}
			if target == nil {
				continue
			}
			targetID = target.ID
		}
		if targetID == memo.ID {
			continue
		}

		publishedState := store.SitePublicationStatePublished
		targetPub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
			SiteID:         &site.ID,
			MemoID:         &targetID,
			State:          &publishedState,
			ExcludeContent: true,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to check linked publication: %v", err)
		}
		if targetPub == nil {
			// Linking a reader to a page that does not exist is a plain error, not
			// something to degrade gracefully — so name the offending link.
			plan.blockers = append(plan.blockers, &v1pb.PublishBlocker{
				Type:      v1pb.BlockerType_UNPUBLISHED_REFERENCE,
				Reference: ref.Href,
				Detail:    "this link points at a document that is not published to this site",
			})
			continue
		}

		hrefToSlug[ref.Href] = targetPub.Slug
		if !seenTargets[targetID] {
			seenTargets[targetID] = true
			plan.links = append(plan.links, &store.SitePublicationLink{TargetMemoID: targetID, RawHref: ref.Href})
		}
	}

	// 3. Collect the attachments the page pulls in, from both links and images.
	attachmentHrefs := map[string]struct{}{}
	for _, refs := range [][]markdown.LinkRef{linkRefs, imageRefs} {
		for _, ref := range refs {
			if _, ok := publish.ParseAttachmentUID(ref.Href); ok {
				attachmentHrefs[ref.Href] = struct{}{}
			}
		}
	}
	seenAttachments := map[int32]bool{}
	for href := range attachmentHrefs {
		uid, _ := publish.ParseAttachmentUID(href)
		attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
		}
		if attachment == nil || seenAttachments[attachment.ID] {
			continue
		}
		seenAttachments[attachment.ID] = true

		switch attachmentacl.EffectiveAccess(attachment) {
		case storepb.AttachmentAccess_ACCESS_LOCKED:
			// The author put this file behind a passphrase. That is an explicit
			// "not for just anyone", and publishing does not get to overrule it on
			// their behalf.
			plan.blockers = append(plan.blockers, &v1pb.PublishBlocker{
				Type:      v1pb.BlockerType_PRIVATE_ATTACHMENT,
				Reference: attachment.Filename,
				Detail:    "this file is protected by a passphrase; unlock it yourself before publishing the page",
			})
		case storepb.AttachmentAccess_ACCESS_PUBLIC:
			plan.attachmentsPublic = append(plan.attachmentsPublic, attachment)
		default:
			// Not public yet. Publishing reports it and moves on rather than
			// flipping the file itself: the page going out and the file going out
			// are two decisions, and only the file's owner gets to make the second
			// one — in Attachments, deliberately, one file at a time.
			plan.attachmentsNotPublic = append(plan.attachmentsNotPublic, attachment)
		}
	}

	// 4. Rewrite what is left onto the site's own paths. A reader who follows a
	// link off to the main application has just been shown the seam.
	body, _, err = s.MarkdownService.RewriteLinks([]byte(body), func(href, text string) (string, string, bool) {
		if slug, ok := hrefToSlug[href]; ok {
			return publish.SiteDocHref(slug), text, true
		}
		if rewritten, ok := publish.SiteAttachmentHref(href); ok {
			return rewritten, text, true
		}
		return href, text, false
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to rewrite document links: %v", err)
	}
	body, _, err = s.MarkdownService.RewriteMediaSources([]byte(body), func(src string) (string, bool) {
		return publish.SiteAttachmentHref(src)
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to rewrite media sources: %v", err)
	}
	plan.content = body

	// 5. Only whitelisted metadata leaves the knowledge base. Comments, history,
	// internal frontmatter, memogit identity markers and author accounts are not
	// on the list, and nothing is added to it by accident: missing a field shows
	// one thing less, letting one through is a disclosure.
	if memo.Payload != nil {
		plan.tags = append([]string{}, memo.Payload.Tags...)
	}
	summary, err := s.getMemoContentSnippet(plan.content)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build summary: %v", err)
	}
	if len([]rune(summary)) > snapshotSummaryLength {
		summary = string([]rune(summary)[:snapshotSummaryLength])
	}
	plan.summary = summary

	return plan, nil
}

func (s *APIV1Service) PreviewPublish(ctx context.Context, request *v1pb.PreviewPublishRequest) (*v1pb.PreviewPublishResponse, error) {
	user, err := s.requireSiteAdmin(ctx)
	if err != nil {
		return nil, err
	}
	site, err := s.getSiteByName(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	memo, err := s.getMemoByName(ctx, request.Memo)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildPublishPlan(ctx, user, site, memo)
	if err != nil {
		return nil, err
	}

	response := &v1pb.PreviewPublishResponse{
		Blockers:            plan.blockers,
		SecretBlocksRemoved: plan.secretBlocksRemoved,
	}
	for _, attachment := range plan.attachmentsNotPublic {
		response.AttachmentsNotPublic = append(response.AttachmentsNotPublic, &v1pb.AttachmentNotice{
			Attachment: AttachmentNamePrefix + attachment.UID,
			Filename:   attachment.Filename,
			MimeType:   attachment.Type,
		})
	}

	existing, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &site.ID,
		MemoID:         &memo.ID,
		ExcludeContent: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check existing publication: %v", err)
	}
	if existing == nil {
		slug, err := s.generateSlugForMemo(ctx, site, memo)
		if err != nil {
			return nil, err
		}
		response.ProposedSlug = slug
	}
	return response, nil
}

// generateSlugForMemo produces the slug a document would get on its first
// publication to a site.
func (s *APIV1Service) generateSlugForMemo(ctx context.Context, site *store.Site, memo *store.Memo) (string, error) {
	var takenErr error
	slug := publish.GenerateSlug("", memo.Title, memo.UID, func(candidate string) bool {
		if takenErr != nil {
			return false
		}
		taken, err := s.slugTakenOnSite(ctx, site.ID, candidate)
		if err != nil {
			takenErr = err
		}
		return taken
	})
	if takenErr != nil {
		return "", status.Errorf(codes.Internal, "failed to generate slug: %v", takenErr)
	}
	return slug, nil
}

func (s *APIV1Service) PublishMemo(ctx context.Context, request *v1pb.PublishMemoRequest) (*v1pb.Publication, error) {
	user, err := s.requireSiteAdmin(ctx)
	if err != nil {
		return nil, err
	}
	site, err := s.getSiteByName(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	memo, err := s.getMemoByName(ctx, request.Memo)
	if err != nil {
		return nil, err
	}

	plan, err := s.buildPublishPlan(ctx, user, site, memo)
	if err != nil {
		return nil, err
	}
	if len(plan.blockers) > 0 {
		return nil, publishBlockedError(plan.blockers)
	}
	existing, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &site.ID,
		MemoID:         &memo.ID,
		ExcludeContent: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check existing publication: %v", err)
	}

	meta, err := json.Marshal(publicationMeta{Tags: plan.tags})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to encode publication meta: %v", err)
	}

	var publication *store.SitePublication
	if existing == nil {
		slug, err := s.generateSlugForMemo(ctx, site, memo)
		if err != nil {
			return nil, err
		}
		publication, err = s.Store.CreateSitePublication(ctx, &store.SitePublication{
			UID:             shortuuid.New(),
			SiteID:          site.ID,
			MemoID:          memo.ID,
			Slug:            slug,
			Title:           plan.title,
			Summary:         plan.summary,
			Content:         plan.content,
			Meta:            string(meta),
			SourceUpdatedTs: memo.UpdatedTs,
			State:           store.SitePublicationStatePublished,
			PublisherID:     user.ID,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to create publication: %v", err)
		}
	} else {
		// Republishing never regenerates the slug: the page's URL was handed out
		// the moment it first went live.
		publishedState := store.SitePublicationStatePublished
		metaStr := string(meta)
		publication, err = s.Store.UpdateSitePublication(ctx, &store.UpdateSitePublication{
			ID:              existing.ID,
			Title:           &plan.title,
			Summary:         &plan.summary,
			Content:         &plan.content,
			Meta:            &metaStr,
			SourceUpdatedTs: &memo.UpdatedTs,
			State:           &publishedState,
			PublisherID:     &user.ID,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to update publication: %v", err)
		}
	}

	// The attachment references are recorded even though publishing granted
	// nothing: they are what answers "which live pages break if this file goes
	// private again".
	refs := make([]*store.SitePublicationAttachment, 0, len(plan.allAttachments()))
	for _, attachment := range plan.allAttachments() {
		refs = append(refs, &store.SitePublicationAttachment{
			PublicationID: publication.ID,
			AttachmentID:  attachment.ID,
		})
	}
	if err := s.Store.ReplaceSitePublicationAttachments(ctx, publication.ID, refs); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to record publication attachments: %v", err)
	}
	for _, link := range plan.links {
		link.PublicationID = publication.ID
	}
	if err := s.Store.ReplaceSitePublicationLinks(ctx, publication.ID, plan.links); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to record publication links: %v", err)
	}

	return convertPublicationFromStore(site, publication, memo, user), nil
}

// publishBlockedError turns the blocker list into an error that names every
// offending reference. An author told only "publishing failed" has nothing to
// act on.
func publishBlockedError(blockers []*v1pb.PublishBlocker) error {
	parts := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		parts = append(parts, blocker.Reference+": "+blocker.Detail)
	}
	return status.Errorf(codes.FailedPrecondition, "cannot publish this document — %s", strings.Join(parts, "; "))
}

// getMemoByName loads a document by resource name without applying the reader
// checks; the caller applies the publisher's own permission context.
func (s *APIV1Service) getMemoByName(ctx context.Context, name string) (*store.Memo, error) {
	memoUID, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	return memo, nil
}
