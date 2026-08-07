package v1

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/linkindex"
	"github.com/usememos/memos/store"
)

// buildWorkspaceLinkTree lists every live document in workspaceID and returns
// both the folder tree used for relative-path link resolution
// (linkindex.ResolveWorkspacePath) and a uid -> memo ID lookup for the same
// set of documents. Archived documents are excluded because the visible
// workspace tree (and therefore relative-path/title resolution, which mirrors
// the frontend) never surfaces them either.
func (s *APIV1Service) buildWorkspaceLinkTree(ctx context.Context, workspaceID int32) ([]*linkindex.TreeNode, map[string]int32, error) {
	normal := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:     &workspaceID,
		RowStatus:       &normal,
		ExcludeContent:  true,
		ExcludeComments: true,
	})
	if err != nil {
		return nil, nil, err
	}

	docs := make([]linkindex.DocRef, 0, len(memos))
	uidToID := make(map[string]int32, len(memos))
	for _, m := range memos {
		if isHomeFolder(m.FolderPath) {
			continue
		}
		docs = append(docs, linkindex.DocRef{UID: m.UID, Title: m.Title, FolderPath: m.FolderPath})
		uidToID[m.UID] = m.ID
	}
	return linkindex.BuildTree(docs), uidToID, nil
}

// resolveMemoLinkTargets parses memo.Content for markdown links and resolves
// each href to the memo ID it points at, per the P0 design
// (docs/dev/design/20260807-cross-reference-repair-plan.md): absolute-form
// hrefs ("/memos/{uid}" or "{host}/memos/{uid}") resolve directly by uid;
// relative-path hrefs resolve against the source memo's own workspace tree,
// mirroring web/src/components/MemoContent/DocumentLinkContext.tsx. Links
// that fail to resolve (dangling, ambiguous, or pointing outside any known
// memo) are silently dropped — the index is best-effort, not a constraint on
// content. Self-links are dropped too.
func (s *APIV1Service) resolveMemoLinkTargets(ctx context.Context, memo *store.Memo) ([]int32, error) {
	if memo.Content == "" {
		return nil, nil
	}
	links, err := s.MarkdownService.ExtractLinks([]byte(memo.Content))
	if err != nil {
		return nil, err
	}
	if len(links) == 0 {
		return nil, nil
	}

	var (
		tree      []*linkindex.TreeNode
		uidToID   map[string]int32
		treeBuilt bool
	)

	targetIDs := make(map[int32]struct{}, len(links))
	for _, link := range links {
		uid, ok := linkindex.ResolveAbsoluteMemoHref(link.Href)
		if !ok {
			if !linkindex.IsRelativeDocHref(link.Href) {
				continue
			}
			if !treeBuilt {
				tree, uidToID, err = s.buildWorkspaceLinkTree(ctx, memo.WorkspaceID)
				if err != nil {
					return nil, err
				}
				treeBuilt = true
			}
			uid, ok = linkindex.ResolveWorkspacePath(tree, link.Href, memo.FolderPath)
			if !ok {
				continue
			}
		}

		id, ok := uidToID[uid]
		if !ok {
			// Absolute links (and relative links resolved before the workspace
			// tree was built) aren't necessarily in uidToID yet; look them up
			// directly. This also covers absolute links that point at a memo
			// outside the source memo's own workspace.
			target, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
			if err != nil || target == nil {
				continue
			}
			id = target.ID
			if uidToID == nil {
				uidToID = make(map[string]int32)
			}
			uidToID[uid] = id
		}
		if id == memo.ID {
			continue
		}
		targetIDs[id] = struct{}{}
	}

	ids := make([]int32, 0, len(targetIDs))
	for id := range targetIDs {
		ids = append(ids, id)
	}
	return ids, nil
}

// syncMemoLinkIndex re-derives memo's outbound reverse-link index entries
// from its current content and overwrites them. Best-effort: the reverse-link
// index is a derived convenience structure, not a constraint on saving memo
// content, so failures here are logged and swallowed rather than surfaced to
// the caller.
func (s *APIV1Service) syncMemoLinkIndex(ctx context.Context, memo *store.Memo) {
	targetIDs, err := s.resolveMemoLinkTargets(ctx, memo)
	if err != nil {
		slog.Warn("failed to resolve memo links", slog.Int("memoID", int(memo.ID)), slog.Any("err", err))
		return
	}
	if err := s.Store.ReplaceMemoLinks(ctx, memo.ID, targetIDs); err != nil {
		slog.Warn("failed to replace memo links", slog.Int("memoID", int(memo.ID)), slog.Any("err", err))
	}
}

// MemoLinkReference identifies a document that references one of the memos
// in a dependency check, for building the "these documents reference this
// content" rejection message.
type MemoLinkReference struct {
	UID   string
	Title string
}

// findExternalLinkReferences returns, for the given set of target memo IDs,
// the distinct set of referencing memos whose ID is NOT in
// excludeMemoIDs (typically the same subtree/container being
// archived/deleted, since a self-reference within the set being removed
// isn't an external dependency). Comment memos are excluded from the result
// since they aren't independently addressable documents.
func (s *APIV1Service) findExternalLinkReferences(ctx context.Context, targetMemoIDs []int32, excludeMemoIDs map[int32]bool) ([]MemoLinkReference, error) {
	if len(targetMemoIDs) == 0 {
		return nil, nil
	}

	links, err := s.Store.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoIDList: targetMemoIDs})
	if err != nil {
		return nil, err
	}
	if len(links) == 0 {
		return nil, nil
	}

	referencingIDs := make(map[int32]struct{})
	for _, link := range links {
		if excludeMemoIDs[link.MemoID] {
			continue
		}
		referencingIDs[link.MemoID] = struct{}{}
	}
	if len(referencingIDs) == 0 {
		return nil, nil
	}

	idList := make([]int32, 0, len(referencingIDs))
	for id := range referencingIDs {
		idList = append(idList, id)
	}
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{IDList: idList, ExcludeContent: true, ExcludeComments: true})
	if err != nil {
		return nil, err
	}

	refs := make([]MemoLinkReference, 0, len(memos))
	for _, m := range memos {
		refs = append(refs, MemoLinkReference{UID: m.UID, Title: m.Title})
	}
	return refs, nil
}

// referenceDependencyError builds the FailedPrecondition error returned when
// an archive/delete is rejected because other documents still reference the
// content (P1). The message enumerates "{title} (memos/{uid})" for every
// referencing document so a caller (or, eventually, the frontend dialog) can
// show the reference list without a second round trip.
func referenceDependencyError(refs []MemoLinkReference) error {
	parts := make([]string, 0, len(refs))
	for _, ref := range refs {
		parts = append(parts, fmt.Sprintf("%s (memos/%s)", ref.Title, ref.UID))
	}
	return status.Errorf(codes.FailedPrecondition,
		"the following documents reference this content and must be updated manually first: %s",
		strings.Join(parts, "; "))
}
