// Command memogit is a local CLI that checks a memos knowledge base out to
// Markdown files and syncs changes back, using a real local git repo for
// version history. See docs/dev/requirements/agent-collab/memogit-sync.md.
package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/usememos/memos/internal/memogit"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "memogit",
		Short: "Check out and sync a memos knowledge base to local files",
		Long: `Check out and sync a memos knowledge base to local files.

memogit borrows git's vocabulary but is not git: it is a DB <-> file bridge over
the memos API, with a real local git repo for history (snapshots only, no
remote). One checkout root holds the credentials once and can track several
knowledge bases, each in its own subfolder:

  my-kb/
  |- .memogit/          config.yaml (server + token), state/ (sync baseline),
  |                     skill/ (the manual for AI agents)
  |- Default/           one document tree per knowledge base
  '- Life/

Typical session:

  memogit login --server https://memos.example.com --token memos_pat_...
  memogit clone "My KB"      # first export + git init + baseline commit
  memogit pull               # fetch server changes
  ... edit files ...
  memogit status             # what is out of sync
  memogit push               # send local edits back
  memogit rm "My KB"         # stop tracking it locally (the server is untouched)

Files are the only carrier of content; everything else (doc type, visibility,
hashes) lives in .memogit/state/. The one exception is the identity marker at
the end of each document -- never delete, edit, or hand-write it.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(loginCmd(), cloneCmd(), workspacesCmd(), pullCmd(), pushCmd(), statusCmd(), rmCmd(), agentsCmd())
	return root
}

func loginCmd() *cobra.Command {
	var server, token string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Save server URL and Personal Access Token to .memogit/config.yaml",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if server == "" || token == "" {
				return fmt.Errorf("both --server and --token are required")
			}
			cfg := &memogit.Config{Server: server, Token: token}
			root, err := os.Getwd()
			if err != nil {
				return err
			}
			if err := cfg.Save(root); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Saved config to %s/%s\n", memogit.MetaDir, memogit.ConfigFile)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "memos server base URL (e.g. https://memos.example.com)")
	cmd.Flags().StringVar(&token, "token", "", "Personal Access Token (memos_pat_...)")
	return cmd
}

func cloneCmd() *cobra.Command {
	var filter, sparse, dir string
	var sparseSubdir bool
	cmd := &cobra.Command{
		Use:   "clone [workspace-title]",
		Short: "First export of a workspace (or one folder via --sparse-checkout) + git init + baseline commit",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cwd, err := os.Getwd()
			if err != nil {
				return err
			}

			// --dir makes a standalone checkout root at that path (used by sparse
			// checkouts): the metadata and content live inside it, and it never
			// joins an existing root. Without --dir, cloning a second knowledge
			// base joins the existing checkout root found from the current dir.
			var root string
			if dir != "" {
				root, err = filepath.Abs(dir)
				if err != nil {
					return err
				}
				if err := os.MkdirAll(root, 0o755); err != nil {
					return fmt.Errorf("create %s: %w", root, err)
				}
			} else {
				root = cwd
				if found, err := memogit.FindRoot(cwd); err == nil {
					root = found
				}
			}

			cfg, err := ensureConfig(cmd, root)
			if err != nil {
				return err
			}
			if err := memogit.Migrate(root, cfg); err != nil {
				return err
			}
			workspaceTitle := ""
			if len(args) == 1 {
				workspaceTitle = args[0]
			}
			return memogit.Clone(cmd.Context(), root, cfg, workspaceTitle, filter, sparse, sparseSubdir, cmd.OutOrStdout())
		},
	}
	cmd.Flags().StringVar(&filter, "filter", "", "optional CEL filter, e.g. '\"work\" in tags'")
	cmd.Flags().StringVar(&sparse, "sparse-checkout", "", "check out only this server folder")
	cmd.Flags().BoolVar(&sparseSubdir, "sparse-subdir", false, "keep --sparse-checkout's folder as a subdirectory of the checkout root, instead of stripping it (default: stripped, so the folder's contents sit at the root)")
	cmd.Flags().StringVar(&dir, "dir", "", "check out into this directory as a standalone root (metadata lives inside it)")
	return cmd
}

// ensureConfig loads the checkout root's config, falling back to an interactive
// console login (server URL + token) when nothing is configured yet, so a fresh
// `memogit clone --dir ...` can prompt in place instead of failing.
func ensureConfig(cmd *cobra.Command, root string) (*memogit.Config, error) {
	cfg, err := memogit.LoadConfig(root)
	if err == nil {
		return cfg, nil
	}
	// Only the "not configured" case is recoverable by prompting; surface any
	// other error (unreadable/corrupt config) as-is.
	if _, statErr := os.Stat(filepath.Join(root, memogit.MetaDir, memogit.ConfigFile)); statErr == nil {
		return nil, err
	}
	server, token, promptErr := promptLogin(cmd)
	if promptErr != nil {
		return nil, promptErr
	}
	cfg = &memogit.Config{Server: server, Token: token}
	if err := cfg.Save(root); err != nil {
		return nil, err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Saved config to %s\n", filepath.Join(root, memogit.MetaDir, memogit.ConfigFile))
	return cfg, nil
}

// promptLogin reads the server URL and Personal Access Token from the console.
// The token is read without echo when stdin is a terminal.
func promptLogin(cmd *cobra.Command) (server, token string, err error) {
	out := cmd.OutOrStdout()
	reader := bufio.NewReader(cmd.InOrStdin())

	fmt.Fprint(out, "memos server URL (e.g. https://memos.example.com): ")
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return "", "", fmt.Errorf("read server URL: %w", err)
	}
	server = strings.TrimSpace(line)
	if server == "" {
		return "", "", fmt.Errorf("server URL is required")
	}

	fmt.Fprint(out, "Personal Access Token (memos_pat_...): ")
	if f, ok := cmd.InOrStdin().(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		b, readErr := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(out)
		if readErr != nil {
			return "", "", fmt.Errorf("read token: %w", readErr)
		}
		token = strings.TrimSpace(string(b))
	} else {
		line, readErr := reader.ReadString('\n')
		if readErr != nil && line == "" {
			return "", "", fmt.Errorf("read token: %w", readErr)
		}
		token = strings.TrimSpace(line)
	}
	if token == "" {
		return "", "", fmt.Errorf("token is required")
	}
	return server, token, nil
}

func workspacesCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "workspaces",
		Aliases: []string{"ws"},
		Short:   "List the account's knowledge bases, marking which are cloned here",
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cwd, err := os.Getwd()
			if err != nil {
				return err
			}
			// Usable before anything is cloned, so fall back to the current dir.
			root := cwd
			if found, err := memogit.FindRoot(cwd); err == nil {
				root = found
			}
			cfg, err := memogit.LoadConfig(root)
			if err != nil {
				return err
			}
			if err := memogit.Migrate(root, cfg); err != nil {
				return err
			}
			return memogit.ListWorkspaces(cmd.Context(), cfg, cmd.OutOrStdout())
		},
	}
}

// selectWorkspaces resolves the checkout root, config, and the workspaces a
// sync command should act on: all of them by default, or the one named on the
// command line. Naming a workspace that is not cloned here is an error rather
// than a silently ignored argument.
func selectWorkspaces(args []string) (string, *memogit.Config, []*memogit.WorkspaceConfig, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", nil, nil, err
	}
	root, err := memogit.FindRoot(cwd)
	if err != nil {
		return "", nil, nil, err
	}
	cfg, err := memogit.LoadConfig(root)
	if err != nil {
		return "", nil, nil, err
	}
	if err := memogit.Migrate(root, cfg); err != nil {
		return "", nil, nil, err
	}
	title := ""
	if len(args) == 1 {
		title = args[0]
	}
	targets, err := cfg.Select(title)
	if err != nil {
		return "", nil, nil, err
	}
	return root, cfg, targets, nil
}

// forEachWorkspace runs one sync command over every selected knowledge base,
// buffering each run's output and printing only the ones that had something to
// report. A checkout with a dozen knowledge bases is mostly in sync at any
// moment, and a screenful of "nothing to push" buries the one that matters.
// When every workspace is quiet a single line says so instead.
func forEachWorkspace(out io.Writer, targets []*memogit.WorkspaceConfig, quietMsg string,
	run func(ws *memogit.WorkspaceConfig, out io.Writer) (bool, error)) error {
	printed := 0
	for _, ws := range targets {
		var buf bytes.Buffer
		quiet, err := run(ws, &buf)
		if err != nil {
			// Print what the run managed to say before failing; it is the context
			// for the error.
			io.Copy(out, &buf)
			return fmt.Errorf("workspace %q: %w", ws.Title, err)
		}
		if quiet {
			continue
		}
		if printed > 0 {
			fmt.Fprintln(out)
		}
		io.Copy(out, &buf)
		printed++
	}
	if printed == 0 {
		fmt.Fprintf(out, "%s (%d knowledge base(s), all in sync).\n", quietMsg, len(targets))
	}
	return nil
}

func pullCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pull [workspace-title]",
		Short: "Incrementally fetch server changes into local files (all knowledge bases, or one by title)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			root, cfg, targets, err := selectWorkspaces(args)
			if err != nil {
				return err
			}
			return forEachWorkspace(cmd.OutOrStdout(), targets, "Nothing to pull",
				func(ws *memogit.WorkspaceConfig, out io.Writer) (bool, error) {
					res, err := memogit.Pull(cmd.Context(), root, cfg, ws, out)
					if err != nil {
						return false, err
					}
					return res.Quiet(), nil
				})
		},
	}
	return cmd
}

func pushCmd() *cobra.Command {
	var dryRun bool
	cmd := &cobra.Command{
		Use:   "push [workspace-title]",
		Short: "Sync local edits back to the server (create/update/archive); attachments are download-only",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			root, cfg, targets, err := selectWorkspaces(args)
			if err != nil {
				return err
			}
			return forEachWorkspace(cmd.OutOrStdout(), targets, "Nothing to push",
				func(ws *memogit.WorkspaceConfig, out io.Writer) (bool, error) {
					res, err := memogit.Push(cmd.Context(), root, cfg, ws, dryRun, out)
					if err != nil {
						return false, err
					}
					return res.Quiet(), nil
				})
		},
	}
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "print the push plan without sending changes")
	return cmd
}

// agentsCmd (re)writes the AI-agent entry points. clone/pull do this on their
// own; this is for older checkouts and for restoring files the user deleted.
func agentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "agents",
		Short: "Write the guide that teaches AI coding agents this checkout's rules",
		Long: `Write the guide that teaches AI coding agents this checkout's rules.

A checkout looks like an ordinary Markdown folder but isn't one, so memogit
drops its own manual into the tree along with the entry points each tool reads
by itself:

  .memogit/` + memogit.GuideDir + `/          the full manual (compiled into this binary)
  AGENTS.md                       Codex and other AGENTS.md-aware agents
  CLAUDE.md                       Claude Code
  .cursor/rules/                  Cursor

The manual is written once, at the root; the three entry points are written at
the root and inside each knowledge base, since agents are often started in one.

clone and pull already do this. Run it by hand for a checkout made with an older
memogit, or to restore a file you deleted. Only the text between memogit's
<!-- BEGIN memogit --> markers is rewritten, so your own notes around it survive.
A path that is already one of your documents is never overwritten.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cwd, err := os.Getwd()
			if err != nil {
				return err
			}
			root, err := memogit.FindRoot(cwd)
			if err != nil {
				return err
			}
			cfg, err := memogit.LoadConfig(root)
			if err != nil {
				return err
			}
			if err := memogit.Migrate(root, cfg); err != nil {
				return err
			}
			return memogit.WriteAgentDocs(root, cfg, cmd.OutOrStdout())
		},
	}
}

// rmCmd is the inverse of clone: stop managing one knowledge base locally.
func rmCmd() *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:   "rm <workspace-title>",
		Short: "Remove a knowledge base from this checkout (local only; the server is untouched)",
		Long: `Remove a knowledge base from this checkout.

Deletes its document folder, its sync baseline in .memogit/state/ and its entry
in config.yaml, then commits the removal. Nothing is deleted on the server: this
is "stop managing this knowledge base here", and re-cloning it later brings
everything back.

It refuses to run while the knowledge base is out of sync with the server —
unpushed edits would be lost without a trace — and while its folder has
uncommitted git changes, which are the one thing the repo's history could not
give back. Get in sync first, or pass --force to delete the local copy anyway.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			root, cfg, targets, err := selectWorkspaces(args)
			if err != nil {
				return err
			}
			_, err = memogit.Remove(cmd.Context(), root, cfg, targets[0], force, cmd.OutOrStdout())
			return err
		},
	}
	cmd.Flags().BoolVar(&force, "force", false, "remove even when out of sync or with uncommitted changes (loses unpushed work)")
	return cmd
}

func statusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status [workspace-title]",
		Short: "Show local/remote changes pending sync, plus local git working-tree state",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			root, cfg, targets, err := selectWorkspaces(args)
			if err != nil {
				return err
			}
			dirty := 0
			if err := forEachWorkspace(cmd.OutOrStdout(), targets, "Nothing to push or pull",
				func(ws *memogit.WorkspaceConfig, out io.Writer) (bool, error) {
					res, err := memogit.Status(cmd.Context(), root, cfg, ws, out)
					if err != nil {
						return false, err
					}
					dirty = res.GitDirty
					return res.Quiet(), nil
				}); err != nil {
				return err
			}
			// The working tree belongs to the checkout, not to any one knowledge
			// base, so report it once at the end rather than per workspace.
			if dirty > 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "Local git: %d uncommitted working-tree change(s) (run `git status`).\n", dirty)
			}
			return nil
		},
	}
	return cmd
}
