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

// Clone performs the first full export: pull every own memo in the given
// workspace into local files, init a git repo, and commit a baseline
// snapshot. root is the KB directory (usually the current working dir).
// workspaceTitle selects which of the user's workspaces (knowledge bases) to
// check out; if empty, the user's default (first) workspace is used, but only
// when they have exactly one — with several, the title must be given
// explicitly so clone never guesses the wrong knowledge base.
func Clone(ctx context.Context, root string, cfg *Config, workspaceTitle, filter, sparse string, out io.Writer) error {
	client := NewClient(cfg)
	username, err := client.CurrentUsername(ctx)
	if err != nil {
		return err
	}

	remote, err := resolveCloneWorkspace(ctx, client, workspaceTitle)
	if err != nil {
		return err
	}
	wsCfg := &WorkspaceConfig{
		Workspace: remote.GetName(),
		Title:     remote.GetTitle(),
		Dir:       workspaceDir(remote.GetTitle()),
		Filter:    filter,
	}
	// A sparse checkout maps one server folder to the checkout root itself: the
	// content sits at the root (Dir "."), the folder prefix is stripped locally
	// (Sparse), and a separate Name identifies the state file since "." can't.
	if sparse = sanitizeFolderPath(sparse); sparse != "" {
		wsCfg.Sparse = sparse
		wsCfg.Dir = "."
		wsCfg.Name = workspaceDir(remote.GetTitle())
	}
	// Refuse to clobber a workspace already checked out into this root.
	if err := cfg.Add(wsCfg); err != nil {
		return err
	}
	if _, err := os.Stat(statePath(root, wsCfg.stateName())); err == nil {
		return fmt.Errorf("already cloned (%s exists); use `memogit pull` to update",
			filepath.Join(MetaDir, StateDir, wsCfg.stateName()+".json"))
	}
	if err := cfg.Save(root); err != nil {
		return err
	}

	if wsCfg.Sparse != "" {
		fmt.Fprintf(out, "Authenticated as %q, fetching memos under folder %q of workspace %q (%s) on %s ...\n",
			username, wsCfg.Sparse, wsCfg.Title, wsCfg.Workspace, cfg.Server)
	} else {
		fmt.Fprintf(out, "Authenticated as %q, fetching memos from workspace %q (%s) on %s ...\n",
			username, wsCfg.Title, wsCfg.Workspace, cfg.Server)
	}

	memos, err := client.ListAllMemos(ctx, wsCfg.Workspace, scopedFilter(username, wsCfg.Filter))
	if err != nil {
		return err
	}

	memos = inScopeMemos(wsCfg, memos)

	state := NewState(cfg.Server)
	if err := checkPathCollisions(wsCfg, memos, out); err != nil {
		return err
	}
	contentRoot := ContentRoot(root, wsCfg)
	attachmentCount := 0
	for _, m := range memos {
		ms, nDown, err := exportMemo(ctx, client, wsCfg, contentRoot, m, nil)
		if err != nil {
			return err
		}
		state.Memos[uidFromName(m.GetName())] = ms
		attachmentCount += nDown
		fmt.Fprintf(out, "  + %s\n", ms.Path)
	}
	state.LastSync = time.Now().UTC()

	if err := state.Save(root, wsCfg.stateName()); err != nil {
		return err
	}
	if err := writeGitignore(root); err != nil {
		return err
	}
	// Make the checkout self-describing to coding agents before the baseline
	// commit, so the guide is part of the first snapshot.
	if err := WriteAgentDocs(root, cfg, out); err != nil {
		return err
	}
	if err := GitInitIfNeeded(root); err != nil {
		return err
	}
	if err := GitCommitAll(root, fmt.Sprintf("memogit clone %s: baseline snapshot of %d memos", wsCfg.Title, len(memos))); err != nil {
		return err
	}

	dest := wsCfg.Dir + "/"
	if wsCfg.Sparse != "" {
		dest = root // sparse checkout: content sits at the root itself
	}
	fmt.Fprintf(out, "Cloned %d memos (%d attachments) into %s and committed baseline.\n", len(memos), attachmentCount, dest)
	return nil
}

// resolveCloneWorkspace resolves the workspace to clone: by explicit title if
// given, otherwise the user's sole workspace (erroring rather than guessing if
// they have more than one).
func resolveCloneWorkspace(ctx context.Context, client *Client, title string) (*v1pb.Workspace, error) {
	if title != "" {
		return client.ResolveWorkspace(ctx, title)
	}
	list, err := client.ListWorkspaces(ctx)
	if err != nil {
		return nil, err
	}
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
