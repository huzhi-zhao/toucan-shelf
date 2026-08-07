package v1

import (
	"context"
	"log/slog"

	"github.com/usememos/memos/internal/linkindex"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

// repairInboundLinksBestEffort implements P4
// (docs/dev/design/20260807-cross-reference-repair-plan.md): after renamed
// has been renamed and/or moved within its own workspace, every document
// that links to it (per the P0 reverse-link index) gets repaired:
//   - href: unconditionally rewritten to renamed's new canonical
//     root-relative path (a single value, computed once here, shared by
//     every referencer — the whole point of the root-relative scheme).
//   - anchor text: only rewritten when it's exactly previousTitle, same
//     independent rule as P2. previousTitle/previousFolderPath are the
//     values as they stood *before* this rename/move — callers pass the
//     unchanged current value on the axis that didn't move, so both are
//     always meaningful.
//
// Best-effort and non-blocking: the rename/move itself has already
// committed by the time this runs, and a partial or failed repair must
// never turn a successful rename into an error. Each referencing document
// is repaired independently, so one failure doesn't block the others.
func (s *APIV1Service) repairInboundLinksBestEffort(ctx context.Context, renamed *store.Memo, previousTitle, previousFolderPath string) {
	links, err := s.Store.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &renamed.ID})
	if err != nil {
		slog.Warn("failed to list inbound links for rename/move repair", slog.Int("memoID", int(renamed.ID)), slog.Any("err", err))
		return
	}
	if len(links) == 0 {
		return
	}

	newHref := linkindex.CanonicalHref(renamed.FolderPath, renamed.Title)

	// Cache one "as-of" workspace link tree per workspace ID: it reflects
	// every document's CURRENT folder/title except renamed, which is patched
	// to its OLD folder/title. Referencers' content still spells the old
	// root-relative path (rewriting happens below, per-referencer) — by the
	// time this runs the rename/move has already committed, so resolving
	// against the tree as it stands now would never match those stale hrefs
	// again. The as-of tree restores the view each stale href was written
	// against, without touching the DB.
	trees := make(map[int32][]*linkindex.TreeNode)
	getOldTree := func(workspaceID int32) ([]*linkindex.TreeNode, error) {
		if tree, ok := trees[workspaceID]; ok {
			return tree, nil
		}
		tree, err := s.buildWorkspaceLinkTreeAsOf(ctx, workspaceID, renamed.UID, previousFolderPath, previousTitle)
		if err != nil {
			return nil, err
		}
		trees[workspaceID] = tree
		return tree, nil
	}

	for _, link := range links {
		if link.MemoID == renamed.ID {
			continue // source-moves-itself: its own outbound hrefs are root-relative and need no repair
		}
		if err := s.repairOneInboundLink(ctx, link.MemoID, renamed, previousTitle, newHref, getOldTree); err != nil {
			slog.Warn("failed to repair inbound link",
				slog.Int("sourceMemoID", int(link.MemoID)), slog.Int("targetMemoID", int(renamed.ID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) repairOneInboundLink(
	ctx context.Context,
	sourceMemoID int32,
	renamed *store.Memo,
	previousTitle string,
	newHref string,
	getOldTree func(workspaceID int32) ([]*linkindex.TreeNode, error),
) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &sourceMemoID})
	if err != nil || source == nil {
		return err
	}

	var repairs []SSELinkRepair
	record := func(oldHref, newHref, oldText, newText string) {
		repairs = append(repairs, SSELinkRepair{OldHref: oldHref, NewHref: newHref, OldText: oldText, NewText: newText})
	}

	decide := func(href, text string) (string, string, bool) {
		newText := text
		anchorMatchesOldTitle := text == previousTitle
		// Independent of href repair: hand-edited anchors keep the user's own
		// wording, only an anchor exactly equal to the old title is stale.
		if anchorMatchesOldTitle {
			newText = renamed.Title
		}

		if uid, ok := linkindex.ResolveAbsoluteMemoHref(href); ok {
			// /memos/{uid} is uid-addressed and never breaks on rename/move;
			// only the anchor text can go stale.
			if uid != renamed.UID || !anchorMatchesOldTitle {
				return href, text, false
			}
			record(href, href, text, newText)
			return href, newText, true
		}

		if !linkindex.IsRootRelativeDocHref(href) {
			return href, text, false
		}
		tree, err := getOldTree(source.WorkspaceID)
		if err != nil {
			return href, text, false
		}
		uid, ok := linkindex.ResolveRootRelativePath(tree, href)
		if !ok || uid != renamed.UID {
			return href, text, false
		}
		if href == newHref && !anchorMatchesOldTitle {
			// Already canonical and no anchor fix needed — this is what makes
			// re-running the same rename/move a no-op the second time.
			return href, text, false
		}
		record(href, newHref, text, newText)
		return newHref, newText, true
	}

	newContent, changed, err := s.MarkdownService.RewriteLinks([]byte(source.Content), decide)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}

	source.Content = newContent
	if err := memopayload.RebuildMemoPayload(ctx, source, s.MarkdownService); err != nil {
		return err
	}

	if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:      source.ID,
		Content: &source.Content,
		Payload: source.Payload,
	}); err != nil {
		return err
	}

	// The rewrite above just changed source's own content (the href/anchor
	// pointing at renamed), so its outbound memo_link rows are now stale too —
	// same reasoning as UpdateMemo's contentUpdated handling. Best-effort,
	// same as the rest of this repair.
	s.syncMemoLinkIndex(ctx, source)
	s.notifyRepairedMemo(ctx, source.ID, repairs)
	return nil
}

// notifyRepairedMemo announces that a repair rewrote memoID's content on its
// owner's behalf. The repair paths write to *other people's documents* — the
// one class of update a client will never refetch on its own, since nothing
// the user did touched that document — so without this the reader keeps
// seeing the stale link until a hard reload, and the search index keeps the
// pre-repair text indefinitely.
//
// Mirrors what UpdateMemo does after a normal content write: SSE broadcast +
// webhook (via dispatchMemoUpdatedSideEffects) and a re-index job. Failures
// are logged and swallowed, matching the best-effort contract of the repair
// itself — a rename must never fail because a notification didn't land.
func (s *APIV1Service) notifyRepairedMemo(ctx context.Context, memoID int32, repairs []SSELinkRepair) {
	if err := s.Store.UpsertMemoIndexJob(ctx, memoID, store.IndexJobReasonUpdated); err != nil {
		slog.Warn("failed to enqueue index job after link repair", slog.Int("memoID", int(memoID)), slog.Any("err", err))
	}

	memo, parentMemo, memoMessage, err := s.buildUpdatedMemoState(ctx, memoID)
	if err != nil {
		slog.Warn("failed to build memo state after link repair", slog.Int("memoID", int(memoID)), slog.Any("err", err))
		return
	}
	s.dispatchMemoUpdatedSideEffectsWithLinkRepairs(ctx, memo, parentMemo, memoMessage, repairs)
}

// rewriteOutboundLinksToUIDBestEffort converts the root-relative hrefs of
// documents that just left oldWorkspaceID into the uid-addressed
// "/memos/{uid}" form, so they keep pointing at what they always pointed at.
//
// Root-relative paths are only meaningful inside one workspace: the moment a
// document crosses a workspace boundary, "/guides/API" stops naming the
// document the author meant and starts naming whatever (usually nothing)
// sits at that path in the destination. The P6 checks guard the other
// direction — documents linking INTO the moved set — but a moved document's
// own outbound links have no such protection, and would simply go dead.
// Rewriting to uid form is lossless: it's an already-supported canonical link
// shape (see ResolveAbsoluteMemoHref) and, being uid-addressed, immune to
// every later rename and move.
//
// keepUIDs names targets that moved along with the source (a folder subtree
// moving as a unit): those stay root-relative, because their paths are
// repaired as a group by the folder-move prefix sweep.
//
// Best-effort, like the rest of this file: the move has already committed.
func (s *APIV1Service) rewriteOutboundLinksToUIDBestEffort(ctx context.Context, memoIDs []int32, oldWorkspaceID int32, keepUIDs map[string]bool) {
	if len(memoIDs) == 0 {
		return
	}
	// The old workspace's tree still holds every document the moved set left
	// behind, which is exactly the set their outbound hrefs can still name.
	tree, _, err := s.buildWorkspaceLinkTree(ctx, oldWorkspaceID)
	if err != nil {
		slog.Warn("failed to build source workspace tree for outbound link rewrite",
			slog.Int("workspaceID", int(oldWorkspaceID)), slog.Any("err", err))
		return
	}

	for _, memoID := range memoIDs {
		if err := s.rewriteOneMemoOutboundLinksToUID(ctx, memoID, tree, keepUIDs); err != nil {
			slog.Warn("failed to rewrite outbound links after cross-workspace move",
				slog.Int("memoID", int(memoID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) rewriteOneMemoOutboundLinksToUID(ctx context.Context, memoID int32, oldTree []*linkindex.TreeNode, keepUIDs map[string]bool) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	if err != nil || source == nil {
		return err
	}

	var repairs []SSELinkRepair
	decide := func(href, text string) (string, string, bool) {
		if !linkindex.IsRootRelativeDocHref(href) {
			return href, text, false
		}
		uid, ok := linkindex.ResolveRootRelativePath(oldTree, href)
		if !ok || keepUIDs[uid] {
			// Unresolvable against the old workspace (already broken, or it
			// names a sibling that moved too) — not ours to rewrite.
			return href, text, false
		}
		newHref := "/memos/" + uid
		repairs = append(repairs, SSELinkRepair{OldHref: href, NewHref: newHref, OldText: text, NewText: text})
		return newHref, text, true
	}

	newContent, changed, err := s.MarkdownService.RewriteLinks([]byte(source.Content), decide)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}

	source.Content = newContent
	if err := memopayload.RebuildMemoPayload(ctx, source, s.MarkdownService); err != nil {
		return err
	}
	if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:      source.ID,
		Content: &source.Content,
		Payload: source.Payload,
	}); err != nil {
		return err
	}
	s.syncMemoLinkIndex(ctx, source)
	s.notifyRepairedMemo(ctx, source.ID, repairs)
	return nil
}
