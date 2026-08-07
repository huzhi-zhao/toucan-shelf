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
// both the folder tree used for root-relative link resolution
// (linkindex.ResolveRootRelativePath) and a uid -> memo ID lookup for the same
// set of documents. Archived documents are excluded because the visible
// workspace tree (and therefore path/title resolution, which mirrors
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

// buildWorkspaceLinkTreeAsOf is buildWorkspaceLinkTree with one document's
// folder/title overridden, for resolving hrefs that were written against an
// earlier state of the tree (P4/P5 repair, after the rename/move has already
// committed to the DB).
func (s *APIV1Service) buildWorkspaceLinkTreeAsOf(ctx context.Context, workspaceID int32, overrideUID, overrideFolderPath, overrideTitle string) ([]*linkindex.TreeNode, error) {
	normal := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:     &workspaceID,
		RowStatus:       &normal,
		ExcludeContent:  true,
		ExcludeComments: true,
	})
	if err != nil {
		return nil, err
	}

	docs := make([]linkindex.DocRef, 0, len(memos))
	for _, m := range memos {
		if isHomeFolder(m.FolderPath) {
			continue
		}
		folderPath, title := m.FolderPath, m.Title
		if m.UID == overrideUID {
			folderPath, title = overrideFolderPath, overrideTitle
		}
		docs = append(docs, linkindex.DocRef{UID: m.UID, Title: title, FolderPath: folderPath})
	}
	return linkindex.BuildTree(docs), nil
}

// resolveMemoLinkTargets parses memo.Content for markdown links and resolves
// each href to the memo ID it points at, per the canonical link form
// (docs/dev/requirements/cross-reference-repair-on-move-rename.md,
// "链接的规范形式"): absolute-form hrefs ("/memos/{uid}" or
// "{host}/memos/{uid}") resolve directly by uid; workspace-root-relative
// hrefs ("/doc/api.md") resolve against the workspace tree, mirroring
// web/src/components/MemoContent/DocumentLinkContext.tsx. Any other href
// shape (including the old bare-relative-path form) is not a document link
// at all now — no tree-wide title fallback. Links that fail to resolve
// (broken, or pointing outside any known memo) are silently dropped — the
// index is best-effort, not a constraint on content. Self-links are dropped
// too.
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
			if !linkindex.IsRootRelativeDocHref(link.Href) {
				continue
			}
			if !treeBuilt {
				tree, uidToID, err = s.buildWorkspaceLinkTree(ctx, memo.WorkspaceID)
				if err != nil {
					return nil, err
				}
				treeBuilt = true
			}
			uid, ok = linkindex.ResolveRootRelativePath(tree, link.Href)
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

// BackfillMemoLinkIndex re-derives the memo_link reverse-link index for every
// live document. It exists because memo_link is populated only on the
// CreateMemo/UpdateMemo write paths (see syncMemoLinkIndex): documents that
// existed before this feature shipped, or that were last content-edited
// before it shipped, never got an index row, silently disabling both P1
// (reference-blocked archive/delete) and P2 (rename repair) for them.
//
// Safe to run on every startup, like the memopayload rebuild it's modeled
// on: ReplaceMemoLinks fully overwrites a memo's outbound rows, so this is
// idempotent and a no-op in steady state (find the diff, this is the only
// full document scan; the query is limited to id/content, not the derived
// fields other admin scans exclude).
func (s *APIV1Service) BackfillMemoLinkIndex(ctx context.Context) {
	const batchSize = 100
	offset := 0
	processed := 0

	for {
		limit := batchSize
		normal := store.Normal
		memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
			RowStatus:       &normal,
			ExcludeComments: true,
			Limit:           &limit,
			Offset:          &offset,
		})
		if err != nil {
			slog.Warn("failed to list memos for link index backfill", slog.Any("err", err))
			return
		}
		if len(memos) == 0 {
			break
		}

		for _, memo := range memos {
			s.syncMemoLinkIndex(ctx, memo)
			processed++
		}

		offset += batchSize
	}

	slog.Info("memo link index backfill finished", slog.Int("processed", processed))
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
