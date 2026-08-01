package v1

import (
	"context"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/store"
)

// agentWritableFields is the set of update_mask paths an agent may send.
//
// This is an allowlist, not a blocklist, and that is the point: update_mask
// grows as the product does, and a blocklist grants every future field by
// default. Whatever is added next has to be considered here before an agent can
// touch it.
//
// What is allowed is authorship (content, title) and placement (folder_path,
// workspace, state, pinned) — an archived or moved document has lost nothing,
// and both are trivially reversible by hand. Everything else is denied:
//
//   - visibility would let an agent publish a private document.
//   - create_time / display_time / update_time falsify the record, and moving
//     update_time backwards silently strands incremental sync clients (memogit
//     pull discovers changes by updated_ts) on a stale copy.
//   - attachments / relations detach things the content refers to.
//   - doc_type reinterprets the whole document.
//   - doc_anchor / pdf_annotation / epub_annotation are comment anchors, and
//     node_overlays / doc_config are app chrome. None of it is authoring.
//
// The MCP tool set exposes MemoService_UpdateMemo as a whole (a tool is one
// OpenAPI operation), so this check — not the tool list — is what actually
// bounds an agent's reach over a document. See requirement.md ADR-2.
var agentWritableFields = map[string]bool{
	"content":     true,
	"title":       true,
	"folder_path": true,
	"workspace":   true,
	"state":       true,
	"pinned":      true,
}

// checkAgentWritableFields rejects an agent-channel update touching anything
// outside agentWritableFields.
func checkAgentWritableFields(paths []string) error {
	for _, path := range paths {
		if !agentWritableFields[path] {
			return status.Errorf(codes.PermissionDenied, "field %q cannot be updated over the MCP channel", path)
		}
	}
	return nil
}

// isAuthorshipField reports whether writing this field means authoring the
// document, as opposed to filing or decorating it. Only these move
// agent_session_open and can trigger a baseline snapshot.
//
// title counts because it is the document's name — losing a human-chosen one to
// an agent rename with no recoverable version is the same class of loss as
// losing content. Note that HashMemoState covers content and attachments but
// not the title, so a title-only edit by a human, followed by an agent write
// with the content untouched, still dedupes against the existing version and
// leaves that title unrecorded. That corner is accepted: folding the title into
// the hash would invalidate every stored content_hash and change
// RestoreMemoHistory's precondition, which is not worth it for a rename.
func isAuthorshipField(path string) bool {
	return path == "content" || path == "title"
}

// agentBaselineVersionName is the display name given to snapshots taken
// automatically before an agent overwrites human content. Manually named
// versions are unaffected; this label is what lets the version list tell the
// two apart.
const agentBaselineVersionName = "AI 编辑前"

// snapshotHumanBaselineIfNeeded captures the memo's current state as a version
// when an agent is about to overwrite content a human wrote.
//
// The rule (requirement.md ADR-3): a snapshot is not a backup of every write,
// it is "the last state a human handed over". So an agent overwriting human
// content snapshots first; an agent overwriting its own earlier output does
// not. That binds the number of snapshots to the number of human editing
// sessions rather than to how many times the agent iterated — an agent may
// rewrite a document fifty times and still leave exactly one recoverable
// version, the one a human actually wrote.
//
// It must be called before the memo is mutated: it snapshots `memo` as loaded.
//
// Returns whether a snapshot was written; the caller does not need it, but the
// tests do.
func (s *APIV1Service) snapshotHumanBaselineIfNeeded(ctx context.Context, memo *store.Memo, creatorID int32) (bool, error) {
	if memo.Payload.GetAgentSessionOpen() {
		// The content about to be overwritten is the agent's own. Regenerating it
		// costs a prompt; a human edit cannot be regenerated at all, and that is
		// the only thing this snapshot protects.
		return false, nil
	}

	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &memo.ID})
	if err != nil {
		return false, err
	}
	snapshotAttachments := make([]*store.MemoHistoryAttachment, 0, len(attachments))
	uids := make([]string, 0, len(attachments))
	for _, a := range attachments {
		snapshotAttachments = append(snapshotAttachments, &store.MemoHistoryAttachment{
			UID:      a.UID,
			Filename: a.Filename,
			Type:     a.Type,
		})
		uids = append(uids, a.UID)
	}

	// Skip when this exact state is already recoverable. Matching against every
	// saved version rather than only the newest matters after a restore: the memo
	// then sits at an older version's content while a newer version is still the
	// most recent record, and comparing only against the newest would duplicate
	// it. RestoreMemoHistory's own precondition treats "matches some version" the
	// same way.
	//
	// The match runs in the database rather than over a loaded list: this is on
	// the path of every agent content write, and versions carry full document
	// bodies. In the common case — no match, so a snapshot is due — the query
	// reads no rows.
	currentHash := store.HashMemoState(memo.Content, uids)
	one := 1
	existing, err := s.Store.ListMemoHistories(ctx, &store.FindMemoHistory{
		MemoID:      &memo.ID,
		ContentHash: &currentHash,
		Limit:       &one,
	})
	if err != nil {
		return false, err
	}
	if len(existing) > 0 {
		return false, nil
	}

	if _, err := s.Store.CreateMemoHistory(ctx, &store.MemoHistory{
		UID:         shortuuid.New(),
		MemoID:      memo.ID,
		Name:        agentBaselineVersionName,
		Title:       memo.Title,
		Content:     memo.Content,
		Payload:     memo.Payload,
		Attachments: snapshotAttachments,
		CreatorID:   creatorID,
	}); err != nil {
		return false, err
	}
	return true, nil
}
