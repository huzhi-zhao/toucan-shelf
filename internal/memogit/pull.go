package memogit

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// PullResult summarizes a pull run.
type PullResult struct {
	Added       int
	Updated     int
	Unchanged   int
	Conflicts   []string // uids skipped because both sides changed
	Missing     []string // uids whose local file is gone (pending push)
	Attachments int      // attachment files freshly downloaded this pull
	Removed     int      // local files removed because deleted/archived on server
	Orphaned    []string // paths deleted on server but kept (locally modified)
}

// Pull incrementally fetches memos changed on the server since the last sync,
// updates local files where only the server changed, and commits. Files where
// both server and local changed are reported as conflicts and left untouched.
func Pull(ctx context.Context, root string, cfg *Config, out io.Writer) (*PullResult, error) {
	state, err := LoadState(root)
	if err != nil {
		return nil, err
	}
	if cfg.Workspace == "" {
		return nil, fmt.Errorf("config missing workspace; re-run `memogit clone` (older config?)")
	}
	client := NewClient(cfg)
	username, err := client.CurrentUsername(ctx)
	if err != nil {
		return nil, err
	}

	// Overlap by one second to avoid missing memos updated in the same second
	// as the last sync; the hash comparison below dedupes the overlap.
	sinceUnix := state.LastSync.Unix() - 1
	// updated_ts is a timestamp field in the CEL schema, so compare against
	// timestamp(<epoch>) rather than a bare int.
	filter := fmt.Sprintf("(%s) && updated_ts > timestamp(%d)", scopedFilter(username, cfg.Filter), sinceUnix)
	fmt.Fprintf(out, "Pulling changes since %s (workspace %q) ...\n", state.LastSync.Format(time.RFC3339), cfg.WorkspaceTitle)

	memos, err := client.ListAllMemos(ctx, cfg.Workspace, filter)
	if err != nil {
		return nil, err
	}

	contentRoot := ContentRoot(root, cfg)
	res := &PullResult{}
	for _, m := range memos {
		uid := uidFromName(m.GetName())
		newState := memoState(m) // path + metadata + canonical server hash
		serverHash := newState.ContentHash

		prev, tracked := state.Memos[uid]
		if !tracked {
			// New memo on the server.
			ms, nDown, err := exportMemo(ctx, client, contentRoot, m, nil)
			if err != nil {
				return nil, err
			}
			state.Memos[uid] = ms
			res.Added++
			res.Attachments += nDown
			fmt.Fprintf(out, "  + %s\n", ms.Path)
			continue
		}

		if serverHash == prev.ContentHash && newState.Path == prev.Path {
			res.Unchanged++
			continue // server didn't really change (overlap re-fetch)
		}

		localPath := filepath.Join(contentRoot, prev.Path)

		// PDF documents have no editable body — the local file is a generated
		// stub, so there is no "local edit" to conflict with. Just re-export and
		// adopt the server state.
		if prev.DocType == "PDF" || newState.DocType == "PDF" {
			ms, nDown, err := relocateMemo(ctx, client, contentRoot, prev.Path, m, &prev)
			if err != nil {
				return nil, err
			}
			state.Memos[uid] = ms
			res.Updated++
			res.Attachments += nDown
			fmt.Fprintf(out, "  ~ %s\n", ms.Path)
			continue
		}

		// Read the local file to see whether it changed since last sync.
		data, readErr := os.ReadFile(localPath)
		if os.IsNotExist(readErr) {
			res.Missing = append(res.Missing, uid)
			fmt.Fprintf(out, "  ! %s: local file missing, skipped (resolve on push)\n", prev.Path)
			continue
		} else if readErr != nil {
			return nil, fmt.Errorf("read %s: %w", prev.Path, readErr)
		}
		if CanonicalHash(string(data)) != prev.ContentHash {
			// Both sides changed → conflict. Leave the local file alone, but write
			// the server version to "<path>.remote" so the user can merge in their
			// editor, and record the conflict so push knows when it's resolved.
			if err := writeConflictSidecar(contentRoot, prev.Path, FileContent(m, prev.Attachments)); err != nil {
				return nil, err
			}
			p := prev
			p.ConflictServerHash = serverHash
			state.Memos[uid] = p
			res.Conflicts = append(res.Conflicts, uid)
			fmt.Fprintf(out, "  ⚠ %s: conflict — server version written to %s, merge and delete it, then push\n",
				prev.Path, conflictSidecarRel(prev.Path))
			continue
		}

		// Only the server changed → adopt server content, relocating the file if
		// its folder_path/title (and thus path) changed.
		ms, nDown, err := relocateMemo(ctx, client, contentRoot, prev.Path, m, &prev)
		if err != nil {
			return nil, err
		}
		// Any prior conflict for this doc is now moot; drop its sidecar.
		removeConflictSidecar(contentRoot, prev.Path)
		removeConflictSidecar(contentRoot, ms.Path)
		state.Memos[uid] = ms
		res.Updated++
		res.Attachments += nDown
		fmt.Fprintf(out, "  ~ %s\n", ms.Path)
	}

	// Reconcile server-side deletions/archives: the incremental filter above
	// never returns deleted or archived memos, so tracked memos that no longer
	// appear in a full current listing are removed locally (unless the local
	// file has unpushed edits, in which case it is kept and reported).
	if err := reconcileServerDeletions(ctx, client, cfg, username, contentRoot, state, res, out); err != nil {
		return nil, err
	}

	state.LastSync = time.Now().UTC()
	if err := state.Save(root); err != nil {
		return nil, err
	}
	if err := GitCommitAll(root, commitMessage(res)); err != nil {
		return nil, err
	}

	fmt.Fprintf(out, "Pull complete: %d added, %d updated, %d removed, %d unchanged, %d conflicts, %d attachments downloaded.\n",
		res.Added, res.Updated, res.Removed, res.Unchanged, len(res.Conflicts), res.Attachments)
	if len(res.Conflicts) > 0 {
		fmt.Fprintf(out, "Conflicts left for manual resolution (uids): %v\n", res.Conflicts)
	}
	if len(res.Orphaned) > 0 {
		fmt.Fprintf(out, "Deleted on server but kept (locally modified): %v\n", res.Orphaned)
	}
	return res, nil
}

// reconcileServerDeletions removes local files for memos that were deleted or
// archived on the server since the last sync. It does a full current listing
// (scoped to the user's own memos in the workspace) and drops any tracked uid
// no longer present — except when the local file has unpushed edits, which it
// keeps and records in res.Orphaned for the user to resolve on push.
func reconcileServerDeletions(ctx context.Context, client *Client, cfg *Config, username, contentRoot string, state *State, res *PullResult, out io.Writer) error {
	current, err := client.ListAllMemos(ctx, cfg.Workspace, scopedFilter(username, cfg.Filter))
	if err != nil {
		return err
	}
	alive := make(map[string]bool, len(current))
	for _, m := range current {
		alive[uidFromName(m.GetName())] = true
	}

	for _, uid := range sortedUIDs(state) {
		if alive[uid] {
			continue
		}
		prev := state.Memos[uid]
		full := filepath.Join(contentRoot, prev.Path)

		// Keep the file if it has local edits we haven't pushed (don't lose work).
		if data, readErr := os.ReadFile(full); readErr == nil && prev.DocType != "PDF" &&
			CanonicalHash(string(data)) != prev.ContentHash {
			res.Orphaned = append(res.Orphaned, prev.Path)
			fmt.Fprintf(out, "  ⚠ %s: deleted on server but modified locally, kept\n", prev.Path)
			continue
		}

		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", prev.Path, err)
		}
		pruneEmptyDirs(contentRoot, filepath.Dir(full))
		removeMemoAttachments(contentRoot, prev.Attachments)
		delete(state.Memos, uid)
		res.Removed++
		fmt.Fprintf(out, "  - %s: removed (deleted/archived on server)\n", prev.Path)
	}
	return nil
}

func commitMessage(res *PullResult) string {
	return fmt.Sprintf("memogit pull: %d added, %d updated", res.Added, res.Updated)
}
