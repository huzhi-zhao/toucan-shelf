package memogit

import (
	"context"
	"fmt"
	"io"
)

// ListWorkspaces prints every knowledge base on the server for the current
// account, marking which are already checked out into this root and which are
// still available to clone. Read-only: it never touches files or sync state.
//
// It answers "what can I clone?" without requiring the user to know any
// resource ids — knowledge bases are always addressed by title on the command
// line; the id exists only as the stable internal anchor that survives renames.
func ListWorkspaces(ctx context.Context, cfg *Config, out io.Writer) error {
	client := NewClient(cfg)
	username, err := client.CurrentUsername(ctx)
	if err != nil {
		return err
	}
	remote, err := client.ListWorkspaces(ctx)
	if err != nil {
		return err
	}
	if len(remote) == 0 {
		fmt.Fprintf(out, "Account %q has no knowledge bases yet; create one in memos first.\n", username)
		return nil
	}

	// Map cloned workspaces by resource name, so a server-side rename still
	// shows as "cloned" rather than as a new knowledge base.
	cloned := make(map[string]*WorkspaceConfig, len(cfg.Workspaces))
	for _, ws := range cfg.Workspaces {
		cloned[ws.Workspace] = ws
	}

	fmt.Fprintf(out, "Knowledge bases for %q on %s:\n\n", username, cfg.Server)
	available := 0
	for _, w := range remote {
		if ws, ok := cloned[w.GetName()]; ok {
			fmt.Fprintf(out, "  ✓ %-24s → %s/\n", w.GetTitle(), ws.Dir)
			continue
		}
		available++
		fmt.Fprintf(out, "    %-24s (not cloned — `memogit clone %s`)\n", w.GetTitle(), w.GetTitle())
	}
	fmt.Fprintf(out, "\n%d checked out here, %d available to clone.\n", len(remote)-available, available)
	return nil
}
