package memogit

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"connectrpc.com/connect"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// Clone performs the first full export: pull every own memo in the given
// workspace into local files, init a git repo, and commit a baseline
// snapshot. root is the KB directory (usually the current working dir).
// workspaceTitle selects which of the user's workspaces (knowledge bases) to
// check out; if empty, the user's default (first) workspace is used, but only
// when they have exactly one — with several, the title must be given
// explicitly so clone never guesses the wrong knowledge base.
func Clone(ctx context.Context, root string, cfg *Config, workspaceTitle string, out io.Writer) error {
	// Refuse to clobber an existing clone.
	if _, err := os.Stat(filepath.Join(root, MetaDir, StateFile)); err == nil {
		return fmt.Errorf("already cloned (%s exists); use `memogit pull` to update", filepath.Join(MetaDir, StateFile))
	}

	client := NewClient(cfg)
	username, err := client.CurrentUsername(ctx)
	if err != nil {
		return err
	}

	ws, err := resolveCloneWorkspace(ctx, client, workspaceTitle)
	if err != nil {
		return err
	}
	cfg.Workspace = ws.GetName()
	cfg.WorkspaceTitle = ws.GetTitle()
	if err := cfg.Save(root); err != nil {
		return err
	}

	fmt.Fprintf(out, "Authenticated as %q, fetching memos from workspace %q (%s) on %s ...\n",
		username, ws.GetTitle(), ws.GetName(), cfg.Server)

	memos, err := client.ListAllMemos(ctx, cfg.Workspace, scopedFilter(username, cfg.Filter))
	if err != nil {
		return err
	}

	state := NewState(cfg.Server)
	if err := checkPathCollisions(memos, out); err != nil {
		return err
	}
	contentRoot := ContentRoot(root, cfg)
	attachmentCount := 0
	for _, m := range memos {
		ms, nDown, err := exportMemo(ctx, client, contentRoot, m, nil)
		if err != nil {
			return err
		}
		state.Memos[uidFromName(m.GetName())] = ms
		attachmentCount += nDown
		fmt.Fprintf(out, "  + %s\n", ms.Path)
	}
	state.LastSync = time.Now().UTC()

	if err := state.Save(root); err != nil {
		return err
	}
	if err := writeGitignore(root); err != nil {
		return err
	}
	if err := GitInitIfNeeded(root); err != nil {
		return err
	}
	if err := GitCommitAll(root, fmt.Sprintf("memogit clone: baseline snapshot of %d memos", len(memos))); err != nil {
		return err
	}

	relContentRoot, _ := filepath.Rel(root, contentRoot)
	fmt.Fprintf(out, "Cloned %d memos (%d attachments) into %s/ and committed baseline.\n", len(memos), attachmentCount, relContentRoot)
	return nil
}

// resolveCloneWorkspace resolves the workspace to clone: by explicit title if
// given, otherwise the user's sole workspace (erroring rather than guessing if
// they have more than one).
func resolveCloneWorkspace(ctx context.Context, client *Client, title string) (*v1pb.Workspace, error) {
	if title != "" {
		return client.ResolveWorkspace(ctx, title)
	}
	resp, err := client.workspace.ListWorkspaces(ctx, connect.NewRequest(&v1pb.ListWorkspacesRequest{}))
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	list := resp.Msg.GetWorkspaces()
	switch len(list) {
	case 0:
		return nil, fmt.Errorf("account has no workspaces yet; create one in memos first")
	case 1:
		return list[0], nil
	default:
		var titles []string
		for _, w := range list {
			titles = append(titles, w.GetTitle())
		}
		return nil, fmt.Errorf("multiple workspaces found, pass one explicitly: memogit clone <title> (have: %v)", titles)
	}
}
