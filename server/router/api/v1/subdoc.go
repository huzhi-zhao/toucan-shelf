package v1

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/store"
)

// Sub-documents: long-form content that belongs to a document without
// belonging in its body.
//
// A sub-document is a child memo of the document it belongs to — the same
// COMMENT relation a comment uses, so it inherits "excluded from the folder
// tree, from search listings, from RSS and from stats" for free. What separates
// it from a comment is where it lives: a reserved folder path.
//
//	comment          = COMMENT relation + folder_path outside SubDocFolderPrefix
//	sub-document     = COMMENT relation + folder_path == "_sub/<parent uid>"
//
// The path is deliberately the ONLY discriminator; there is no payload flag
// beside it. A flag would be a second source of truth for the same fact and the
// two would drift, whereas the path has to be written correctly at creation
// time or the row does not exist at all.
//
// Why a reserved path rather than the empty folder every comment has: a
// sub-document needs a real title (the References section labels itself with it,
// and memogit names its local file after it), and titles are unique per
// (workspace, folder_path) — see idx_memo_workspace_folder_title. With an empty
// folder path a sub-document called "补充说明" would collide with a top-level
// document of that name. Scoping it under the parent's uid gives every parent
// its own namespace, keeps two sub-documents of the same parent from sharing a
// title, and survives the parent being renamed or moved (the path keys off the
// uid, not the title or the location).
//
// Requirements: docs/dev/requirements/knowledge-base/sub-documents.md.
const SubDocFolderPrefix = "_sub"

// SubDocFolderPath is the folder path every sub-document of parentUID lives at.
func SubDocFolderPath(parentUID string) string {
	return SubDocFolderPrefix + "/" + parentUID
}

// ParentUIDFromSubDocFolderPath reads the parent document's uid out of a
// normalized folder path, reporting whether the path addresses a sub-document at
// all. A path under the reserved prefix that is not exactly "_sub/<uid>" (a bare
// "_sub", or a deeper nesting) is NOT a sub-document path: sub-documents are one
// level deep, like the comment relation they are built on.
func ParentUIDFromSubDocFolderPath(folderPath string) (string, bool) {
	rest, ok := strings.CutPrefix(folderPath, SubDocFolderPrefix+"/")
	if !ok || rest == "" || strings.Contains(rest, "/") {
		return "", false
	}
	return rest, true
}

// IsReservedFolderPath reports whether a folder path reaches into the reserved
// sub-document namespace. Used to keep ordinary documents (and user-created
// folders) out of it: only the sub-document creation path may write there, and
// only in the exact "_sub/<uid>" shape.
func IsReservedFolderPath(folderPath string) bool {
	return folderPath == SubDocFolderPrefix || strings.HasPrefix(folderPath, SubDocFolderPrefix+"/")
}

// resolveSubDocParent turns a folder path into the parent document it binds to.
// It returns (nil, nil) when the path is not a sub-document path at all, so the
// caller can carry on creating an ordinary document.
//
// A path under the reserved prefix that does not resolve is rejected rather than
// created as a plain document: silently dropping the binding would leave a
// document stranded in a folder the tree never shows, reachable by nothing.
func (s *APIV1Service) resolveSubDocParent(ctx context.Context, user *store.User, folderPath string) (*store.Memo, error) {
	parentUID, ok := ParentUIDFromSubDocFolderPath(folderPath)
	if !ok {
		if IsReservedFolderPath(folderPath) {
			return nil, status.Errorf(codes.InvalidArgument,
				"%q is reserved for sub-documents; a sub-document's folder path must be exactly %q", SubDocFolderPrefix, SubDocFolderPrefix+"/<parent document uid>")
		}
		return nil, nil
	}

	parent, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &parentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get parent document")
	}
	if parent == nil {
		return nil, status.Errorf(codes.NotFound, "parent document %q not found", parentUID)
	}
	// Writing a sub-document is a write to the document it hangs off, so it is
	// gated by the parent's workspace grant rather than by the sub-document's own.
	if err := s.checkMemoWriteAccess(ctx, user, parent); err != nil {
		return nil, err
	}
	// One level deep, matching the comment relation underneath: a sub-document
	// cannot itself carry sub-documents.
	if IsReservedFolderPath(parent.FolderPath) {
		return nil, status.Errorf(codes.InvalidArgument, "a sub-document cannot have sub-documents of its own")
	}
	return parent, nil
}

// listChildMemos returns a parent document's child memos — both its comments
// and its sub-documents, which share the COMMENT relation. Callers split them
// apart by folder path.
func (s *APIV1Service) listChildMemos(ctx context.Context, parentID int32) ([]*store.Memo, error) {
	commentType := store.MemoRelationComment
	relations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
		RelatedMemoID: &parentID,
		Type:          &commentType,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list child memos")
	}
	children := make([]*store.Memo, 0, len(relations))
	for _, relation := range relations {
		child, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &relation.MemoID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to get child memo")
		}
		if child != nil {
			children = append(children, child)
		}
	}
	return children, nil
}

// subDocIDsOf returns the memo IDs of a document's sub-documents, for the
// reference guards that must treat a parent and its sub-documents as one
// document rather than as documents referencing each other.
func (s *APIV1Service) subDocIDsOf(ctx context.Context, memo *store.Memo) ([]int32, error) {
	children, err := s.listChildMemos(ctx, memo.ID)
	if err != nil {
		return nil, err
	}
	ids := make([]int32, 0, len(children))
	for _, child := range children {
		if _, ok := ParentUIDFromSubDocFolderPath(child.FolderPath); ok {
			ids = append(ids, child.ID)
		}
	}
	return ids, nil
}

// internalReferenceExclusions builds the exclude set for findExternalLinkReferences
// so that a document and its own sub-documents never block each other from being
// archived or deleted. A sub-document is part of the document it hangs off, so a
// link between the two is an internal reference, not an outside dependency.
//
// It covers both directions: the parent's body linking down to a sub-document
// (which would otherwise block removing that sub-document), and a sub-document
// linking back up to its parent (which would otherwise block archiving the
// parent). Links from any OTHER document are untouched and still block.
func (s *APIV1Service) internalReferenceExclusions(ctx context.Context, memo *store.Memo) (map[int32]bool, error) {
	excluded := map[int32]bool{memo.ID: true}

	// The document's own sub-documents: their links up to it are internal.
	subDocIDs, err := s.subDocIDsOf(ctx, memo)
	if err != nil {
		return nil, err
	}
	for _, id := range subDocIDs {
		excluded[id] = true
	}

	// The other direction: this memo IS a sub-document, so its parent's links
	// down to it are internal too.
	if parentUID, ok := ParentUIDFromSubDocFolderPath(memo.FolderPath); ok {
		parent, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &parentUID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to get parent document")
		}
		if parent != nil {
			excluded[parent.ID] = true
		}
	}
	return excluded, nil
}

// cascadeSubDocState moves a document's sub-documents into or out of the recycle
// bin with it. A sub-document is part of the document it hangs off, so leaving
// one NORMAL behind an archived parent would leave content reachable that the
// user believes they have put away — and, the other way round, restoring a
// parent must bring its sub-documents back with it.
//
// Comments are deliberately left alone: a comment is a discussion *about* the
// document, and archiving a document has never meant archiving its thread.
//
// Like the visibility cascade next to it, this skips reindexing: row status is
// not part of what gets embedded (title and content are), so it must not
// re-queue the sub-document.
func (s *APIV1Service) cascadeSubDocState(ctx context.Context, memo *store.Memo) error {
	children, err := s.listChildMemos(ctx, memo.ID)
	if err != nil {
		return err
	}
	for _, child := range children {
		if _, ok := ParentUIDFromSubDocFolderPath(child.FolderPath); !ok {
			continue // a comment, not a sub-document
		}
		if child.RowStatus == memo.RowStatus {
			continue
		}
		rowStatus := memo.RowStatus
		if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
			ID:          child.ID,
			RowStatus:   &rowStatus,
			SkipReindex: true,
		}); err != nil {
			return errors.Wrap(err, "failed to update sub-document state")
		}
	}
	return nil
}

// touchSubDocParent bumps the parent's updated_ts when one of its sub-documents
// is written.
//
// This is the product rule made mechanical: a sub-document is part of the
// document it hangs off, so that document genuinely did change when its
// sub-document changed, and its "last updated" should say so — in the workspace
// tree's freshness tint as much as anywhere else.
//
// It is also what keeps an incremental mirror correct. memogit selects on
// updated_ts and then walks each changed document's sub-documents; a
// sub-document edited on the server while its parent sat still would otherwise
// be invisible to every later sync, and the local copy would stay stale forever
// with nothing reporting it.
//
// Best-effort on purpose: failing to bump a timestamp must not fail the write
// that succeeded. The cost of a miss is one stale mirror entry until the next
// write, not lost content.
func (s *APIV1Service) touchSubDocParentBestEffort(ctx context.Context, memo *store.Memo) {
	parentUID, ok := ParentUIDFromSubDocFolderPath(memo.FolderPath)
	if !ok {
		return
	}
	parent, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &parentUID})
	if err != nil || parent == nil {
		return
	}
	now := time.Now().Unix()
	if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:        parent.ID,
		UpdatedTs: &now,
		// Neither the parent's title nor its content changed, so this must not
		// re-queue it for embedding.
		SkipReindex: true,
	}); err != nil {
		slog.Warn("failed to touch sub-document parent", slog.Any("err", err))
	}
}
