package memogit

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// scopedFilter combines the implicit "own memos only" scoping with an optional
// extra CEL clause from config.
func scopedFilter(username, extra string) string {
	// The `creator` CEL field compares against the user's resource name
	// ("users/<username>"), not the bare username, so scope with that form.
	base := fmt.Sprintf("creator == %s", strconv.Quote("users/"+username))
	if strings.TrimSpace(extra) == "" {
		return base
	}
	return fmt.Sprintf("(%s) && (%s)", base, extra)
}

// ContentRoot returns the directory under the checkout root where one
// workspace's document files live, so the repo root holds only metadata
// (.memogit, .git, .gitignore) and each knowledge base's notes sit under their
// own named folder. All sync-state paths are relative to this.
func ContentRoot(root string, ws *WorkspaceConfig) string {
	return filepath.Join(root, ws.Dir)
}

// writeFile writes raw content to <root>/<relPath>, creating parent dirs and
// ensuring exactly one trailing newline for clean git diffs.
func writeFile(root, relPath, content string) error {
	full := filepath.Join(root, relPath)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("create dir for %s: %w", relPath, err)
	}
	body := strings.TrimRight(content, "\n") + "\n"
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", relPath, err)
	}
	return nil
}

// localHash hashes a work-tree file's bytes the way the server sees them: with
// the local identity marker removed. Every comparison between a local file and
// its baseline must go through this — hashing the raw bytes would read the
// marker as an edit and manufacture a conflict on the next sync.
func localHash(data []byte) string {
	return CanonicalHash(StripLocalID(string(data)))
}

// ensureLocalIDs re-stamps tracked files whose identity marker is missing or
// points at the wrong memo, and returns how many it fixed. It exists for
// checkouts made before markers (their files carry none, so a move of one would
// still be pushed as delete+create) and to heal files whose marker was deleted
// by a hand or an agent. Re-stamping never counts as a local edit, because the
// marker is stripped before hashing.
func ensureLocalIDs(contentRoot string, state *State) (int, error) {
	n := 0
	for _, uid := range sortedUIDs(state) {
		ms := state.Memos[uid]
		data, err := os.ReadFile(filepath.Join(contentRoot, ms.Path))
		if err != nil {
			continue // missing/unreadable files are reported by the callers
		}
		raw := string(data)
		if ParseLocalID(raw) == uid {
			continue
		}
		if err := writeFile(contentRoot, ms.Path, InjectLocalID(raw, uid, ms.DocType)); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// memoState builds the sync-state baseline for a memo (path + metadata + hash).
// The hash is over the server content (m.GetContent()), which is what push/pull
// compare against — not over the possibly-stubbed local file bytes.
func memoState(ws *WorkspaceConfig, m *v1pb.Memo) MemoState {
	docType := docTypeString(m)
	relPath := ws.LocalRelPath(m.GetFolderPath(), m.GetTitle(), docType)
	return MemoState{
		Path:        relPath,
		DocType:     docType,
		Visibility:  m.GetVisibility().String(),
		Pinned:      m.GetPinned(),
		Relations:   relationUIDs(m),
		UpdateTime:  tsToTime(m.GetUpdateTime()),
		ContentHash: CanonicalHash(m.GetContent()),
	}
}

// exportMemo downloads the memo's attachments, writes the doc file (verbatim
// content, or a PDF stub pointing at the downloaded bytes), and returns its
// baseline MemoState plus the number of attachments freshly downloaded. prev is
// the previous baseline for this memo (nil on first export), used to skip
// re-downloading unchanged attachments.
func exportMemo(ctx context.Context, client *Client, ws *WorkspaceConfig, contentRoot string, m *v1pb.Memo, prev *MemoState, warn *attachmentWarner) (MemoState, int, error) {
	var prevRefs []AttachmentRef
	if prev != nil {
		prevRefs = prev.Attachments
	}
	refs, n, err := downloadMemoAttachments(ctx, client, contentRoot, memoState(ws, m).Path, m, prevRefs, warn)
	if err != nil {
		return MemoState{}, 0, err
	}
	ms, err := writeMemoDoc(ws, contentRoot, m, refs)
	if err != nil {
		return MemoState{}, 0, err
	}
	return ms, n, nil
}

// writeMemoDoc writes a memo's doc file (verbatim content, or a PDF stub) using
// the given downloaded attachment refs, and returns its baseline MemoState. The
// attachment download is done by the caller; this is the pure file-writing step
// (also the unit-test seam that needs no server).
func writeMemoDoc(ws *WorkspaceConfig, contentRoot string, m *v1pb.Memo, refs []AttachmentRef) (MemoState, error) {
	ms := memoState(ws, m)
	ms.Attachments = refs
	if err := writeFile(contentRoot, ms.Path, FileContent(m, refs)); err != nil {
		return MemoState{}, err
	}
	return ms, nil
}

// relocateMemo is like exportMemo but for an already-tracked memo whose file may
// have moved (folder_path/title changed): it downloads attachments, writes the
// new file, and removes the old one. Returns the new baseline + downloads.
func relocateMemo(ctx context.Context, client *Client, ws *WorkspaceConfig, contentRoot, oldRel string, m *v1pb.Memo, prev *MemoState, warn *attachmentWarner) (MemoState, int, error) {
	var prevRefs []AttachmentRef
	if prev != nil {
		prevRefs = prev.Attachments
	}
	ms := memoState(ws, m)
	refs, n, err := downloadMemoAttachments(ctx, client, contentRoot, ms.Path, m, prevRefs, warn)
	if err != nil {
		return MemoState{}, 0, err
	}
	ms.Attachments = refs
	if err := relocateAndWrite(contentRoot, oldRel, ms.Path, FileContent(m, refs)); err != nil {
		return MemoState{}, 0, err
	}
	return ms, n, nil
}

// relocateAndWrite writes content to newRel, and if the file moved from oldRel
// it removes the old file and prunes any now-empty parent directories (up to,
// but not including, the repo root) so relocations don't leave empty folders.
func relocateAndWrite(root, oldRel, newRel, content string) error {
	if err := writeFile(root, newRel, content); err != nil {
		return err
	}
	if oldRel == newRel {
		return nil
	}
	oldFull := filepath.Join(root, oldRel)
	if err := os.Remove(oldFull); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove old file %s: %w", oldRel, err)
	}
	pruneEmptyDirs(root, filepath.Dir(oldFull))
	return nil
}

// pruneEmptyDirs removes dir and its empty ancestors up to (exclusive) root.
// Non-empty dirs stop the walk; errors are ignored (best-effort cleanup).
func pruneEmptyDirs(root, dir string) {
	rootClean := filepath.Clean(root)
	for {
		dir = filepath.Clean(dir)
		if dir == rootClean || !strings.HasPrefix(dir, rootClean+string(filepath.Separator)) {
			return
		}
		if err := os.Remove(dir); err != nil {
			return // not empty, or gone
		}
		dir = filepath.Dir(dir)
	}
}

// inScopeMemos returns only the memos that belong to the workspace's checkout:
// for a sparse checkout, those under the mapped folder (the server has no
// folder_path filter, so scoping happens client-side after ListAllMemos), and in
// every case only those that land on a path the work-tree scanner can actually
// see.
func inScopeMemos(ws *WorkspaceConfig, memos []*v1pb.Memo) []*v1pb.Memo {
	out := memos[:0:0]
	for _, m := range memos {
		if ws.Sparse != "" && !ws.inScope(m.GetFolderPath()) {
			continue
		}
		if isHiddenPath(ws.LocalRelPath(m.GetFolderPath(), m.GetTitle(), docTypeString(m))) {
			continue
		}
		out = append(out, m)
	}
	return out
}

// isHiddenPath reports whether a repo-relative path lies under a dot-directory
// (or is itself a dotfile). listDocFiles skips those, so exporting such a memo
// would write a file nothing can ever find again: it would read as "deleted
// locally" on the very next push and archive a live document. The server's
// reserved Home folder (".home") is exactly this case — it holds the Home page's
// configuration, which the server itself hides from the workspace tree and which
// was never meant to be checked out.
func isHiddenPath(relPath string) bool {
	for _, seg := range strings.Split(filepath.ToSlash(relPath), "/") {
		if strings.HasPrefix(seg, ".") {
			return true
		}
	}
	return false
}

// checkPathCollisions guards against two distinct server documents mapping to
// the same local path after sanitization (e.g. titles differing only in
// reserved characters). The server's (workspace, folder_path, title) uniqueness
// prevents true duplicates, but filename sanitization can still collapse them,
// which would silently overwrite one file. Fail loudly instead.
func checkPathCollisions(ws *WorkspaceConfig, memos []*v1pb.Memo, out io.Writer) error {
	seen := make(map[string]string, len(memos)) // path -> "folder_path::title"
	for _, m := range memos {
		p := ws.LocalRelPath(m.GetFolderPath(), m.GetTitle(), docTypeString(m))
		key := m.GetFolderPath() + "::" + m.GetTitle()
		if prev, ok := seen[p]; ok && prev != key {
			return fmt.Errorf("path collision: %q and %q both map to %q; "+
				"rename one on the server (titles differ only in reserved characters)", prev, key, p)
		}
		seen[p] = key
	}
	return nil
}
