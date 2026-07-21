package memogit

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
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
func Pull(ctx context.Context, root string, cfg *Config, ws *WorkspaceConfig, out io.Writer) (*PullResult, error) {
	state, err := LoadState(root, ws.Dir)
	if err != nil {
		return nil, err
	}
	if ws.Workspace == "" {
		return nil, fmt.Errorf("config missing workspace; re-run `memogit clone` (older config?)")
	}
	client := NewClient(cfg)
	username, err := client.CurrentUsername(ctx)
	if err != nil {
		return nil, err
	}
	if err := syncWorkspaceTitle(ctx, client, root, cfg, ws, out); err != nil {
		return nil, err
	}

	// Overlap by one second to avoid missing memos updated in the same second
	// as the last sync; the hash comparison below dedupes the overlap.
	sinceUnix := state.LastSync.Unix() - 1
	// updated_ts is a timestamp field in the CEL schema, so compare against
	// timestamp(<epoch>) rather than a bare int.
	filter := fmt.Sprintf("(%s) && updated_ts > timestamp(%d)", scopedFilter(username, ws.Filter), sinceUnix)
	fmt.Fprintf(out, "Pulling changes since %s (workspace %q) ...\n", state.LastSync.Format(time.RFC3339), ws.Title)

	memos, err := client.ListAllMemos(ctx, ws.Workspace, filter)
	if err != nil {
		return nil, err
	}

	contentRoot := ContentRoot(root, ws)
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

	// Reconcile against a full current listing: catches server-side deletions
	// (never returned by the incremental filter) and path drift (memos whose
	// folder/title changed without their updated_ts moving).
	if err := reconcileFullListing(ctx, client, ws, username, contentRoot, state, res, out); err != nil {
		return nil, err
	}

	state.LastSync = time.Now().UTC()
	if err := state.Save(root, ws.Dir); err != nil {
		return nil, err
	}
	if err := GitCommitAll(root, commitMessage(ws, res)); err != nil {
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

// syncWorkspaceTitle follows a server-side rename. The workspace is tracked by
// its resource name, which never changes, so a renamed knowledge base stays
// bound to the same local files: only the recorded title is refreshed (used to
// select it on the command line). The checkout directory is deliberately left
// alone — renaming it would move every tracked file and lose git blame — so
// after a rename the folder keeps its original name.
//
// A workspace that no longer exists is reported rather than treated as "every
// memo was deleted", which would otherwise wipe the local files.
func syncWorkspaceTitle(ctx context.Context, client *Client, root string, cfg *Config, ws *WorkspaceConfig, out io.Writer) error {
	remote, err := client.WorkspaceByName(ctx, ws.Workspace)
	if err != nil {
		return err
	}
	if remote == nil {
		return fmt.Errorf("workspace %q (%s) no longer exists on the server; "+
			"local files in %s/ were left untouched", ws.Title, ws.Workspace, ws.Dir)
	}
	if remote.GetTitle() == ws.Title {
		return nil
	}
	fmt.Fprintf(out, "  workspace renamed on the server: %q → %q (folder %s/ unchanged)\n",
		ws.Title, remote.GetTitle(), ws.Dir)
	ws.Title = remote.GetTitle()
	return cfg.Save(root)
}

// reconcileFullListing walks a full current listing (scoped to the user's own
// memos in the workspace) and fixes up two things the incremental pass can miss:
//
//   - deletions/archives: tracked uids no longer present are removed locally,
//     except when the local file has unpushed edits, which are kept and recorded
//     in res.Orphaned for the user to resolve on push.
//   - path drift: a tracked memo whose server folder_path/title no longer matches
//     the local path is relocated. Moves don't always bump updated_ts (older
//     server versions never did), so the incremental filter can miss them
//     entirely; comparing paths here makes pull self-healing.
func reconcileFullListing(ctx context.Context, client *Client, ws *WorkspaceConfig, username, contentRoot string, state *State, res *PullResult, out io.Writer) error {
	current, err := client.ListAllMemos(ctx, ws.Workspace, scopedFilter(username, ws.Filter))
	if err != nil {
		return err
	}
	alive := make(map[string]*v1pb.Memo, len(current))
	for _, m := range current {
		alive[uidFromName(m.GetName())] = m
	}

	for _, uid := range sortedUIDs(state) {
		if m := alive[uid]; m != nil {
			if err := relocateDrifted(ctx, client, contentRoot, uid, m, state, res, out); err != nil {
				return err
			}
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

// relocateDrifted moves a tracked memo's local file when the server path no
// longer matches the recorded one. A locally modified file is left alone (the
// move would silently discard the edit's location); it is reported so the user
// can push first and pull again.
func relocateDrifted(ctx context.Context, client *Client, contentRoot, uid string, m *v1pb.Memo, state *State, res *PullResult, out io.Writer) error {
	prev := state.Memos[uid]
	newPath := memoState(m).Path
	if newPath == prev.Path {
		return nil
	}

	if prev.DocType != "PDF" {
		data, readErr := os.ReadFile(filepath.Join(contentRoot, prev.Path))
		if readErr != nil {
			// Missing/unreadable file: the incremental pass already reports these.
			return nil
		}
		if CanonicalHash(string(data)) != prev.ContentHash {
			res.Orphaned = append(res.Orphaned, prev.Path)
			fmt.Fprintf(out, "  ⚠ %s: moved on server to %s but modified locally, kept in place\n", prev.Path, newPath)
			return nil
		}
	}

	ms, nDown, err := relocateMemo(ctx, client, contentRoot, prev.Path, m, &prev)
	if err != nil {
		return err
	}
	removeConflictSidecar(contentRoot, prev.Path)
	state.Memos[uid] = ms
	res.Updated++
	res.Attachments += nDown
	fmt.Fprintf(out, "  → %s → %s\n", prev.Path, ms.Path)
	return nil
}

func commitMessage(ws *WorkspaceConfig, res *PullResult) string {
	return fmt.Sprintf("memogit pull %s: %d added, %d updated", ws.Title, res.Added, res.Updated)
}
