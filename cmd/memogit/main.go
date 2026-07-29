// Command memogit is a local CLI that checks a memos knowledge base out to
// Markdown files and syncs changes back, using a real local git repo for
// version history. See docs/plans/2026-07-13-memogit-cli.
package main

import (
	"bufio"
	"fmt"
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
		Use:           "memogit",
		Short:         "Check out and sync a memos knowledge base to local files",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(loginCmd(), cloneCmd(), workspacesCmd(), pullCmd(), pushCmd(), statusCmd(), agentsCmd())
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
			return memogit.Clone(cmd.Context(), root, cfg, workspaceTitle, filter, sparse, cmd.OutOrStdout())
		},
	}
	cmd.Flags().StringVar(&filter, "filter", "", "optional CEL filter, e.g. '\"work\" in tags'")
	cmd.Flags().StringVar(&sparse, "sparse-checkout", "", "check out only this server folder (its prefix is stripped locally)")
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
			for i, ws := range targets {
				if i > 0 {
					fmt.Fprintln(cmd.OutOrStdout())
				}
				if _, err := memogit.Pull(cmd.Context(), root, cfg, ws, cmd.OutOrStdout()); err != nil {
					return fmt.Errorf("workspace %q: %w", ws.Title, err)
				}
			}
			return nil
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
			for i, ws := range targets {
				if i > 0 {
					fmt.Fprintln(cmd.OutOrStdout())
				}
				if _, err := memogit.Push(cmd.Context(), root, cfg, ws, dryRun, cmd.OutOrStdout()); err != nil {
					return fmt.Errorf("workspace %q: %w", ws.Title, err)
				}
			}
			return nil
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
		Short: "Write the AI-agent guide (.memogit/" + memogit.GuideFile + ") and AGENTS.md / CLAUDE.md / .cursor rules",
		Args:  cobra.NoArgs,
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
			for i, ws := range targets {
				if i > 0 {
					fmt.Fprintln(cmd.OutOrStdout())
				}
				if _, err := memogit.Status(cmd.Context(), root, cfg, ws, cmd.OutOrStdout()); err != nil {
					return fmt.Errorf("workspace %q: %w", ws.Title, err)
				}
			}
			return nil
		},
	}
	return cmd
}
