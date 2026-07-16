package memogit

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// StatusResult is the computed sync state shown by `memogit status`.
type StatusResult struct {
	// Local changes pending push.
	LocalModified []string
	LocalNew      []string
	LocalDeleted  []string
	// Remote changes pending pull.
	RemoteNew     []string
	RemoteUpdated []string
	RemoteDeleted []string
	// Changed on both sides (a push/pull will report a conflict).
	Conflicts []string
	// Uncommitted git working-tree entries.
	GitDirty int
}

// Status computes and prints what is out of sync between the local checkout and
// the server, in two layers: (1) local vs server pending changes, and (2) the
// local git working tree. It is read-only — it hits the server to compare but
// never writes files, sync-state, or memos.
func Status(ctx context.Context, root string, cfg *Config, out io.Writer) (*StatusResult, error) {
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
	contentRoot := ContentRoot(root, cfg)
	pathIndex := state.PathIndex()

	res := &StatusResult{GitDirty: GitStatusPorcelain(root)}

	// Full current server listing (scoped to own memos in the workspace):
	// used for both remote-new/updated and remote-deleted detection.
	current, err := client.ListAllMemos(ctx, cfg.Workspace, scopedFilter(username, cfg.Filter))
	if err != nil {
		return nil, err
	}
	serverByUID := make(map[string]string, len(current)) // uid -> canonical server hash
	alive := make(map[string]bool, len(current))
	for _, m := range current {
		uid := uidFromName(m.GetName())
		serverByUID[uid] = CanonicalHash(m.GetContent())
		alive[uid] = true
	}

	// --- Local side: walk the work tree, classify each file. ---
	present, err := listDocFiles(contentRoot)
	if err != nil {
		return nil, err
	}
	presentSet := make(map[string]bool, len(present))
	for _, rel := range present {
		presentSet[rel] = true
		if docTypeFromExt(rel) == "PDF" {
			continue // generated stub, not editable
		}
		uid, tracked := pathIndex[rel]
		if !tracked {
			res.LocalNew = append(res.LocalNew, rel)
			continue
		}
		prev := state.Memos[uid]
		if prev.DocType == "PDF" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(contentRoot, rel))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", rel, err)
		}
		localChanged := CanonicalHash(string(data)) != prev.ContentHash
		serverChanged := alive[uid] && serverByUID[uid] != prev.ContentHash
		switch {
		case localChanged && serverChanged:
			res.Conflicts = append(res.Conflicts, rel)
		case localChanged:
			res.LocalModified = append(res.LocalModified, rel)
		}
	}

	// --- Remote side: tracked memos whose server hash moved (pull will bring
	// them down), plus brand-new server memos and server-side deletions. ---
	for uid, srvHash := range serverByUID {
		prev, tracked := state.Memos[uid]
		if !tracked {
			// New on the server; name it by where it will land locally.
			res.RemoteNew = append(res.RemoteNew, serverPath(current, uid))
			continue
		}
		if srvHash != prev.ContentHash && !contains(res.Conflicts, prev.Path) {
			res.RemoteUpdated = append(res.RemoteUpdated, prev.Path)
		}
	}
	for _, uid := range sortedUIDs(state) {
		if !alive[uid] {
			res.RemoteDeleted = append(res.RemoteDeleted, state.Memos[uid].Path)
		}
	}

	// Local files tracked but now missing → pending archive on push.
	for _, uid := range sortedUIDs(state) {
		prev := state.Memos[uid]
		if !presentSet[prev.Path] && alive[uid] {
			res.LocalDeleted = append(res.LocalDeleted, prev.Path)
		}
	}

	printStatus(out, cfg, res)
	return res, nil
}

// serverPath returns the local relative path a server memo (identified by uid)
// would map to, for display of remote-new documents.
func serverPath(memos []*v1pb.Memo, uid string) string {
	for _, m := range memos {
		if uidFromName(m.GetName()) == uid {
			return RelPath(m.GetFolderPath(), m.GetTitle(), docTypeString(m))
		}
	}
	return uid
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

func printStatus(out io.Writer, cfg *Config, res *StatusResult) {
	fmt.Fprintf(out, "memogit status (workspace %q)\n\n", cfg.WorkspaceTitle)

	type line struct {
		marker string
		items  []string
	}
	group := func(title string, lines ...line) {
		total := 0
		for _, l := range lines {
			total += len(l.items)
		}
		if total == 0 {
			return
		}
		fmt.Fprintf(out, "%s\n", title)
		for _, l := range lines {
			items := append([]string(nil), l.items...)
			sort.Strings(items)
			for _, it := range items {
				fmt.Fprintf(out, "  %s %s\n", l.marker, it)
			}
		}
		fmt.Fprintln(out)
	}

	group("Local changes to push:",
		line{"~", res.LocalModified}, line{"+", res.LocalNew}, line{"-", res.LocalDeleted})
	group("Remote changes to pull:",
		line{"~", res.RemoteUpdated}, line{"+", res.RemoteNew}, line{"-", res.RemoteDeleted})
	group("Conflicts (changed on both sides — resolve manually):",
		line{"⚠", res.Conflicts})

	nLocal := len(res.LocalModified) + len(res.LocalNew) + len(res.LocalDeleted)
	nRemote := len(res.RemoteUpdated) + len(res.RemoteNew) + len(res.RemoteDeleted)
	if nLocal == 0 && nRemote == 0 && len(res.Conflicts) == 0 {
		fmt.Fprintln(out, "In sync with the server. Nothing to push or pull.")
	} else {
		fmt.Fprintf(out, "Summary: %d to push, %d to pull, %d conflicts.\n", nLocal, nRemote, len(res.Conflicts))
	}
	if res.GitDirty > 0 {
		fmt.Fprintf(out, "Local git: %d uncommitted working-tree change(s) (run `git status`).\n", res.GitDirty)
	}
}
