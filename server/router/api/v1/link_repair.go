package v1

import (
	"context"
	"log/slog"

	"github.com/usememos/memos/internal/linkindex"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

// repairInboundLinkAnchorsBestEffort implements P2
// (docs/dev/design/20260807-cross-reference-repair-plan.md): after renamed
// is renamed from previousTitle to its current title, every document that
// links to it (per the P0 reverse-link index) gets its matching link anchor
// text silently updated, provided the anchor text is exactly the old title
// — a hand-edited anchor is left alone, since that's the user's own wording,
// not a stale label.
//
// Best-effort and non-blocking by design: the rename itself has already
// committed by the time this runs, and a partial or failed repair must never
// turn a successful rename into an error. Each referencing document is
// repaired independently, so one failure doesn't block the others.
func (s *APIV1Service) repairInboundLinkAnchorsBestEffort(ctx context.Context, renamed *store.Memo, previousTitle string) {
	links, err := s.Store.ListMemoLinks(ctx, &store.FindMemoLink{TargetMemoID: &renamed.ID})
	if err != nil {
		slog.Warn("failed to list inbound links for rename repair", slog.Int("memoID", int(renamed.ID)), slog.Any("err", err))
		return
	}
	if len(links) == 0 {
		return
	}

	// Cache one workspace link tree per workspace ID: multiple referencing
	// documents commonly live in the same workspace as each other (though not
	// necessarily the same workspace as renamed).
	//
	// The tree is patched to show `renamed` under its OLD title. Relative-path
	// hrefs resolve via title fallback (mirroring the frontend), and the href
	// text itself still spells the old title (e.g. "Old%20Title.md") — by the
	// time this runs, the rename has already committed, so resolving against
	// the tree as it stands now would never find a node named "Old Title"
	// again and every relative link would look unresolvable. Patching restores
	// the view the link was valid against, without touching the DB.
	trees := make(map[int32][]*linkindex.TreeNode)
	getTree := func(workspaceID int32) ([]*linkindex.TreeNode, error) {
		if tree, ok := trees[workspaceID]; ok {
			return tree, nil
		}
		tree, _, err := s.buildWorkspaceLinkTree(ctx, workspaceID)
		if err != nil {
			return nil, err
		}
		if node := linkindex.FindNodeByUID(tree, renamed.UID); node != nil {
			node.Name = previousTitle
		}
		trees[workspaceID] = tree
		return tree, nil
	}

	for _, link := range links {
		if link.MemoID == renamed.ID {
			continue // self-reference; nothing meaningful to repair
		}
		if err := s.repairOneInboundLinkAnchor(ctx, link.MemoID, renamed, previousTitle, getTree); err != nil {
			slog.Warn("failed to repair inbound link anchor",
				slog.Int("sourceMemoID", int(link.MemoID)), slog.Int("targetMemoID", int(renamed.ID)), slog.Any("err", err))
		}
	}
}

func (s *APIV1Service) repairOneInboundLinkAnchor(
	ctx context.Context,
	sourceMemoID int32,
	renamed *store.Memo,
	previousTitle string,
	getTree func(workspaceID int32) ([]*linkindex.TreeNode, error),
) error {
	source, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &sourceMemoID})
	if err != nil || source == nil {
		return err
	}

	decide := func(href, text string) (string, bool) {
		if text != previousTitle {
			// Anchor text was hand-edited (or already up to date); the design
			// doc is explicit that only anchors exactly equal to the old title
			// get touched, so user wording is never overwritten.
			return "", false
		}

		if uid, ok := linkindex.ResolveAbsoluteMemoHref(href); ok {
			if uid != renamed.UID {
				return "", false
			}
			return renamed.Title, true
		}

		if !linkindex.IsRelativeDocHref(href) {
			return "", false
		}
		tree, err := getTree(source.WorkspaceID)
		if err != nil {
			return "", false
		}
		uid, ok := linkindex.ResolveWorkspacePath(tree, href, source.FolderPath)
		if !ok || uid != renamed.UID {
			return "", false
		}
		return renamed.Title, true
	}

	newContent, changed, err := s.MarkdownService.RewriteLinkAnchors([]byte(source.Content), decide)
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

	return s.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:      source.ID,
		Content: &source.Content,
		Payload: source.Payload,
	})
}
