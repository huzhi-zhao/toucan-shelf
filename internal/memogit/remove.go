package memogit

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// RemoveResult summarizes what `memogit rm` deleted locally.
type RemoveResult struct {
	// Files removed from the work tree.
	Files int
	// Dir is the checkout folder that was deleted, "" for a sparse checkout
	// (whose content lives at the root, so only its own files are removed).
	Dir string
}

// Remove drops one knowledge base from the local checkout: its document folder,
// its sync baseline, and its config entry. Nothing on the server is touched —
// this is "stop managing this knowledge base here", not a delete.
//
// It refuses to run while the checkout is out of sync with the server. Local
// edits that were never pushed would be lost silently, and server documents that
// were never pulled would make the removal look like a clean round trip when it
// was not. Getting back in sync first (`memogit pull` / `memogit push`) makes the
// removal provably lossless: everything here is also on the server.
//
// It equally refuses while the workspace's folder has uncommitted git changes.
// Everything committed survives in the repo's history and can be restored from
// there, but work that never reached a commit is gone for good once the folder
// is deleted, so that is exactly the case worth stopping for.
//
// force skips both checks, for a checkout the user has decided to throw away.
func Remove(ctx context.Context, root string, cfg *Config, ws *WorkspaceConfig, force bool, out io.Writer) (*RemoveResult, error) {
	if !force {
		if err := checkRemovable(ctx, root, cfg, ws); err != nil {
			return nil, err
		}
	}

	state, err := LoadState(root, ws.stateName())
	if err != nil {
		return nil, err
	}
	contentRoot := ContentRoot(root, ws)

	res := &RemoveResult{}
	if ws.Sparse != "" || ws.Dir == "." || ws.Dir == "" {
		// Sparse checkout: the content sits at the checkout root next to metadata
		// and possibly other workspaces' folders, so only this workspace's own
		// tracked files may go.
		n, err := removeTrackedFiles(contentRoot, state)
		if err != nil {
			return nil, err
		}
		res.Files = n
	} else {
		n, err := countFiles(contentRoot)
		if err != nil {
			return nil, err
		}
		if err := os.RemoveAll(contentRoot); err != nil {
			return nil, fmt.Errorf("remove %s: %w", contentRoot, err)
		}
		res.Files = n
		res.Dir = ws.Dir
	}

	if err := os.Remove(statePath(root, ws.stateName())); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("remove sync state: %w", err)
	}
	cfg.forget(ws)
	if err := cfg.Save(root); err != nil {
		return nil, err
	}

	// Commit so the removal is a revertible point in history rather than files
	// that simply vanished between two commits.
	if err := GitCommitAll(root, fmt.Sprintf("memogit rm %s: %d file(s) removed locally", ws.Title, res.Files)); err != nil {
		return nil, err
	}

	if res.Dir != "" {
		fmt.Fprintf(out, "Removed knowledge base %q from this checkout: %s/ (%d file(s)).\n", ws.Title, res.Dir, res.Files)
	} else {
		fmt.Fprintf(out, "Removed knowledge base %q from this checkout: %d file(s).\n", ws.Title, res.Files)
	}
	fmt.Fprintf(out, "Nothing was deleted on %s — re-clone it any time with `memogit clone %q`.\n", cfg.Server, ws.Title)
	return res, nil
}

// checkRemovable is Remove's precondition: the workspace must be in sync with
// the server, and its folder free of uncommitted git changes.
func checkRemovable(ctx context.Context, root string, cfg *Config, ws *WorkspaceConfig) error {
	var buf bytes.Buffer
	st, err := Status(ctx, root, cfg, ws, &buf)
	if err != nil {
		return err
	}
	if !st.Quiet() {
		return fmt.Errorf("knowledge base %q is not in sync with the server, refusing to remove it:\n\n%s\n"+
			"Run `memogit pull %s` and `memogit push %s` until it reports no pending changes, then remove it "+
			"(or pass --force to delete the local copy anyway, losing whatever was never pushed)",
			ws.Title, strings.TrimRight(buf.String(), "\n"), ws.Title, ws.Title)
	}
	if dirty := gitDirtyPaths(root, ContentRoot(root, ws)); len(dirty) > 0 {
		return fmt.Errorf("%s/ has %d uncommitted git change(s), refusing to remove it:\n  %s\n"+
			"Commit or discard them first (they are not on the server and not in the repo's history, "+
			"so deleting the folder now would lose them), or pass --force",
			ws.Dir, len(dirty), strings.Join(dirty, "\n  "))
	}
	return nil
}

// gitDirtyPaths lists `git status --porcelain` entries under one directory.
// Unlike GitStatusPorcelain (a repo-wide count), this scopes the question to the
// folder about to be deleted: another workspace's dirty files are none of this
// command's business.
func gitDirtyPaths(root, dir string) []string {
	out, err := git(root, "status", "--porcelain", "--", dir)
	if err != nil {
		return nil
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}

// removeTrackedFiles deletes exactly the files the baseline knows about (plus
// their attachments), pruning the directories that become empty. Used for a
// sparse checkout, where blowing away the whole content root would take the
// checkout's metadata and every other workspace with it.
func removeTrackedFiles(contentRoot string, state *State) (int, error) {
	n := 0
	for _, uid := range sortedUIDs(state) {
		ms := state.Memos[uid]
		full := filepath.Join(contentRoot, ms.Path)
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			return n, fmt.Errorf("remove %s: %w", ms.Path, err)
		}
		n++
		pruneEmptyDirs(contentRoot, filepath.Dir(full))
		removeMemoAttachments(contentRoot, ms.Attachments)
	}
	return n, nil
}

// countFiles counts the regular files under dir, for the removal summary.
func countFiles(dir string) (int, error) {
	n := 0
	err := filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if !d.IsDir() {
			n++
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("count files in %s: %w", dir, err)
	}
	return n, nil
}

// forget drops a workspace entry from the config.
func (c *Config) forget(ws *WorkspaceConfig) {
	kept := c.Workspaces[:0]
	for _, existing := range c.Workspaces {
		if existing == ws || existing.Workspace == ws.Workspace {
			continue
		}
		kept = append(kept, existing)
	}
	c.Workspaces = kept
}
