// Command memogit is a local CLI that checks a memos knowledge base out to
// Markdown files and syncs changes back, using a real local git repo for
// version history. See docs/plans/2026-07-13-memogit-cli.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

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
	root.AddCommand(loginCmd(), cloneCmd(), pullCmd(), pushCmd(), statusCmd())
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
	var filter string
	cmd := &cobra.Command{
		Use:   "clone [workspace-title]",
		Short: "First full export of a workspace (knowledge base) + git init + baseline commit",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			root, err := os.Getwd()
			if err != nil {
				return err
			}
			cfg, err := memogit.LoadConfig(root)
			if err != nil {
				return err
			}
			if filter != "" {
				cfg.Filter = filter
			}
			workspaceTitle := ""
			if len(args) == 1 {
				workspaceTitle = args[0]
			}
			return memogit.Clone(cmd.Context(), root, cfg, workspaceTitle, cmd.OutOrStdout())
		},
	}
	cmd.Flags().StringVar(&filter, "filter", "", "optional CEL filter, e.g. '\"work\" in tags'")
	return cmd
}

func pullCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pull",
		Short: "Incrementally fetch server changes into local files",
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
			_, err = memogit.Pull(cmd.Context(), root, cfg, cmd.OutOrStdout())
			return err
		},
	}
	return cmd
}

func pushCmd() *cobra.Command {
	var dryRun bool
	cmd := &cobra.Command{
		Use:   "push",
		Short: "Sync local edits back to the server (create/update/archive); attachments are download-only",
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
			_, err = memogit.Push(cmd.Context(), root, cfg, dryRun, cmd.OutOrStdout())
			return err
		},
	}
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "print the push plan without sending changes")
	return cmd
}

func statusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show local/remote changes pending sync, plus local git working-tree state",
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
			_, err = memogit.Status(cmd.Context(), root, cfg, cmd.OutOrStdout())
			return err
		},
	}
	return cmd
}
