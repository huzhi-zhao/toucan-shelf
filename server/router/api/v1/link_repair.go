package v1

import (
	"context"
	"log/slog"
	"strings"

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
	// A referencer left behind in another knowledge base cannot use the
	// root-relative form — that names a path in ITS OWN knowledge base. It gets
	// the workspace-qualified form instead (库限定路径). This is what makes a
	// cross-workspace move repairable at all, and is why P6 no longer rejects
	// one; see docs/dev/design/20260829-relative-and-cross-workspace-refs.md R2.5.
	crossHref := s.crossWorkspaceHrefFor(ctx, renamed)

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
			// Source-moves-itself. Its root-relative and uid hrefs are
			// unaffected by its own move; its document-relative hrefs ARE, and
			// are fossilized separately by fossilizeOutboundRelativeLinks —
			// not here, because this pass only knows about links pointing at
			// `renamed`, whereas every one of the mover's outbound relative
			// hrefs needs fixing regardless of target.
			continue
		}
		if err := s.repairOneInboundLink(ctx, link.MemoID, renamed, previousTitle, newHref, crossHref, getOldTree); err != nil {
			slog.Warn("failed to repair inbound link",
				slog.Int("sourceMemoID", int(link.MemoID)), slog.Int("targetMemoID", int(renamed.ID)), slog.Any("err", err))
		}
	}
}

// crossWorkspaceHrefFor builds the workspace-qualified href
// ("@库标题/fb/dc.md") that a document in another knowledge base must use to
// reach memo. Falls back to the uid form when the target's knowledge base
// cannot be named — its title violates the constraints the form needs
// (validateWorkspaceTitle), or the lookup failed. The uid form always works and
// is never wrong, only less readable.
func (s *APIV1Service) crossWorkspaceHrefFor(ctx context.Context, memo *store.Memo) string {
	uidHref := "/memos/" + memo.UID
	workspace, err := s.Store.GetWorkspace(ctx, &store.FindWorkspace{ID: &memo.WorkspaceID})
	if err != nil || workspace == nil {
		return uidHref
	}
	href := linkindex.WorkspaceQualifiedHref(workspace.Title, memo.FolderPath, memo.Title)
	if !linkindex.IsWorkspaceQualifiedHref(href) {
		return uidHref
	}
	return href
}

func (s *APIV1Service) repairOneInboundLink(
	ctx context.Context,
	sourceMemoID int32,
	renamed *store.Memo,
	previousTitle string,
	newHref string,
	crossHref string,
	getOldTree func(workspaceID int32) ([]*linkindex.TreeNode, error),
) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &sourceMemoID})
	if err != nil || source == nil {
		return err
	}
	// Which form this referencer must use depends on where IT lives, not on
	// where the target went.
	if source.WorkspaceID != renamed.WorkspaceID {
		newHref = crossHref
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

		if !linkindex.IsInWorkspaceDocHref(href) {
			return href, text, false
		}
		tree, err := getOldTree(source.WorkspaceID)
		if err != nil {
			return href, text, false
		}
		// The referencing document didn't move here — the target did — so its
		// own folder is still the base a document-relative href was written
		// against. The repair writes the canonical root-relative form either
		// way: a relative href whose target moved out from under it no longer
		// describes anything the author meant, so there is no authored
		// relative form left to preserve.
		uid, ok := linkindex.ResolveInWorkspace(tree, source.FolderPath, href)
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

// rewriteOutboundLinksAfterWorkspaceMoveBestEffort repoints the in-workspace hrefs of
// documents that just left oldWorkspaceID at the knowledge base they came
// from, so they keep naming what they always named.
//
// In-workspace paths are only meaningful inside one workspace: the moment a
// document crosses a workspace boundary, "/guides/API" stops naming the
// document the author meant and starts naming whatever (usually nothing) sits
// at that path in the destination. A moved document's own outbound links have
// no protection against that and would simply go dead.
//
// The repair writes the workspace-qualified form ("@旧库标题/guides/API"),
// which keeps the link readable and keeps naming the same document. The
// uid-addressed "/memos/{uid}" form is the fallback for when the old knowledge
// base cannot be named (see crossWorkspaceHrefFor): always correct, just less
// legible. Both are canonical link shapes immune to the destination
// workspace's own layout.
//
// keepUIDs names targets that moved along with the source (a folder subtree
// moving as a unit): those stay root-relative, because their paths are
// repaired as a group by the folder-move prefix sweep.
//
// Best-effort, like the rest of this file: the move has already committed.
// oldFolderPaths maps each moved memo's ID to the folder it occupied BEFORE
// the move — document-relative hrefs must be resolved against that, not
// against where the memo has since landed.
func (s *APIV1Service) rewriteOutboundLinksAfterWorkspaceMoveBestEffort(ctx context.Context, oldFolderPaths map[int32]string, oldWorkspaceID int32, keepUIDs map[string]bool) {
	if len(oldFolderPaths) == 0 {
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

	for memoID, oldFolderPath := range oldFolderPaths {
		if err := s.rewriteOneMemoOutboundLinksAfterWorkspaceMove(ctx, memoID, oldFolderPath, tree, keepUIDs); err != nil {
			slog.Warn("failed to rewrite outbound links after cross-workspace move",
				slog.Int("memoID", int(memoID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) rewriteOneMemoOutboundLinksAfterWorkspaceMove(ctx context.Context, memoID int32, oldFolderPath string, oldTree []*linkindex.TreeNode, keepUIDs map[string]bool) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	if err != nil || source == nil {
		return err
	}

	var repairs []SSELinkRepair
	decide := func(href, text string) (string, string, bool) {
		if !linkindex.IsInWorkspaceDocHref(href) {
			return href, text, false
		}
		uid, ok := linkindex.ResolveInWorkspace(oldTree, oldFolderPath, href)
		if !ok || keepUIDs[uid] {
			// Unresolvable against the old workspace (already broken, or it
			// names a sibling that moved too) — not ours to rewrite.
			return href, text, false
		}
		target, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
		if err != nil || target == nil {
			return href, text, false
		}
		newHref := s.crossWorkspaceHrefFor(ctx, target)
		if newHref == href {
			return href, text, false
		}
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

// fossilizeOutboundRelativeLinksBestEffort rewrites a moved document's own
// document-relative hrefs ("./db.md", "../fb/dc.md") to the canonical
// root-relative form.
//
// This is the one case where the system rewrites a link the author wrote in a
// relative form. Everywhere else the authored form is stored verbatim and
// resolved at render time, precisely so re-editing the document shows what was
// written. But a relative href means "relative to where I am", and a move is
// exactly the event that changes where the referencing document is: leaving the
// text alone would silently repoint every one of its relative links at whatever
// (usually nothing) sits at the corresponding path near the destination. The
// target did not move, so the reference must be pinned to the target's own
// location — which is what the root-relative form is.
//
// oldFolderPaths maps memo ID to the folder it occupied BEFORE the move.
// Documents whose folder did not actually change are skipped.
//
// Three href classes are deliberately left untouched:
//   - hrefs that still resolve from the document's NEW folder — the whole
//     subtree moved as a unit, so the relative path between them is unchanged
//     and the authored form is still exactly right;
//   - hrefs that resolve from NEITHER folder — either already broken, or (for
//     the bare relative form) never a document reference at all. Rewriting
//     "example.com/page" into "/example.com/page" would destroy a working
//     external link, so an unresolvable href is always left as written;
//   - everything that is not a relative href.
//
// The rewrite is therefore idempotent: a second run sees root-relative hrefs
// and does nothing. Best-effort, like the rest of this file: the move has
// already committed.
func (s *APIV1Service) fossilizeOutboundRelativeLinksBestEffort(ctx context.Context, workspaceID int32, oldFolderPaths map[int32]string) {
	if len(oldFolderPaths) == 0 {
		return
	}
	tree, _, err := s.buildWorkspaceLinkTree(ctx, workspaceID)
	if err != nil {
		slog.Warn("failed to build workspace tree for relative link fossilization",
			slog.Int("workspaceID", int(workspaceID)), slog.Any("err", err))
		return
	}
	for memoID, oldFolderPath := range oldFolderPaths {
		if err := s.fossilizeOneMemoOutboundRelativeLinks(ctx, memoID, oldFolderPath, tree); err != nil {
			slog.Warn("failed to fossilize outbound relative links after move",
				slog.Int("memoID", int(memoID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) fossilizeOneMemoOutboundRelativeLinks(
	ctx context.Context,
	memoID int32,
	oldFolderPath string,
	tree []*linkindex.TreeNode,
) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	if err != nil || source == nil {
		return err
	}
	if source.FolderPath == oldFolderPath {
		return nil
	}

	var repairs []SSELinkRepair
	decide := func(href, text string) (string, string, bool) {
		if !linkindex.IsRelativeDocHref(href) {
			return href, text, false
		}
		if _, ok := linkindex.ResolveRelativePath(tree, source.FolderPath, href); ok {
			// Still resolves from where the document now sits: the target moved
			// with it, so the authored relative form is still correct.
			return href, text, false
		}
		if _, ok := linkindex.ResolveRelativePath(tree, oldFolderPath, href); !ok {
			// Named nothing before the move either — not a stale document
			// reference, so not ours to rewrite.
			return href, text, false
		}
		newHref, ok := linkindex.ResolveRelativeToCanonical(oldFolderPath, href)
		if !ok {
			return href, text, false
		}
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

// repairWorkspaceTitleReferencesBestEffort rewrites "@旧库标题/…" hrefs to
// "@新库标题/…" after a knowledge base is renamed (R2.6).
//
// Simpler than every other repair in this file: the workspace-qualified form
// addresses a knowledge base by title, so a rename changes exactly one value
// and every referencer changes by the same substitution — no as-of tree, no
// per-target href computation.
//
// The referencers are found through the memo_link index: an "@" href resolves
// to a target memo ID at index time (see workspaceLinkTrees), so every document
// holding one has a row pointing into this workspace.
//
// Best-effort and non-blocking, like the rest of this file: the rename has
// already committed, and a document whose repair fails simply keeps a link that
// no longer resolves until the next content edit re-runs it.
//
// TODO: this can rewrite many documents in one call, so it multiplies the
// "batch writes should share one transaction and one index rebuild" TODO
// already recorded in
// docs/dev/requirements/cross-reference-repair-on-move-rename.md.
func (s *APIV1Service) repairWorkspaceTitleReferencesBestEffort(ctx context.Context, workspaceID int32, oldTitle, newTitle string) {
	if oldTitle == newTitle {
		return
	}
	targets, err := s.Store.ListMemos(ctx, &store.FindMemo{
		WorkspaceID:     &workspaceID,
		ExcludeContent:  true,
		ExcludeComments: true,
	})
	if err != nil {
		slog.Warn("failed to list workspace documents for rename repair",
			slog.Int("workspaceID", int(workspaceID)), slog.Any("err", err))
		return
	}

	sourceIDs := map[int32]struct{}{}
	for _, target := range targets {
		links, err := s.Store.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &target.ID})
		if err != nil {
			slog.Warn("failed to list inbound links for workspace rename repair",
				slog.Int("memoID", int(target.ID)), slog.Any("err", err))
			continue
		}
		for _, link := range links {
			sourceIDs[link.MemoID] = struct{}{}
		}
	}

	for sourceID := range sourceIDs {
		if err := s.repairOneMemoWorkspaceTitleReference(ctx, sourceID, oldTitle, newTitle); err != nil {
			slog.Warn("failed to repair workspace-qualified links after rename",
				slog.Int("memoID", int(sourceID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) repairOneMemoWorkspaceTitleReference(ctx context.Context, memoID int32, oldTitle, newTitle string) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	if err != nil || source == nil {
		return err
	}

	var repairs []SSELinkRepair
	decide := func(href, text string) (string, string, bool) {
		title, _, ok := linkindex.ParseWorkspaceQualifiedHref(href)
		if !ok || !strings.EqualFold(strings.TrimSpace(title), strings.TrimSpace(oldTitle)) {
			return href, text, false
		}
		newHref, ok := linkindex.RetitleWorkspaceQualifiedHref(href, newTitle)
		if !ok || newHref == href {
			return href, text, false
		}
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
