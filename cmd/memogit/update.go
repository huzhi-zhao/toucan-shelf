package main

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/usememos/memos/internal/memogit"
)

func selfUpdateCmd() *cobra.Command {
	var server string
	cmd := &cobra.Command{
		Use:   "self-update",
		Short: "Replace this binary with the memogit build published by the server",
		Long: `Replace this binary with the memogit build published by the server.

The server publishes the memogit built from the same commit it runs, at
<server>/memogit/. The server URL comes from --server, else the environment
(TOUCANSHELF_SERVER / MEMOGIT_SERVER), else the checkout found from the current
directory.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if server == "" {
				server = resolveServer()
			}
			if server == "" {
				return fmt.Errorf("no server: pass --server, set %s, or run inside a checkout", memogit.EnvToucanServer)
			}
			dist, err := memogit.FetchDistribution(cmd.Context(), server, 30*time.Second)
			if err != nil {
				return err
			}
			if dist.Version == version() {
				fmt.Fprintf(cmd.OutOrStdout(), "Already up to date: memogit %s\n", dist.Version)
				return nil
			}
			_, err = memogit.SelfUpdate(cmd.Context(), server, cmd.OutOrStdout())
			return err
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "server URL (default: from the environment or the current checkout)")
	return cmd
}

// resolveServer finds the server URL without requiring a token: the
// environment first, then the checkout found from the current directory.
func resolveServer() string {
	if s := memogit.ServerFromEnv(); s != "" {
		return s
	}
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	root, err := memogit.FindRoot(cwd)
	if err != nil {
		return ""
	}
	cfg, err := memogit.LoadConfig(root)
	if err != nil {
		return ""
	}
	return cfg.Server
}

// syncCommands are the ones that already talk to the server, so a version
// check after them costs one small request and no extra waiting on failure.
var syncCommands = map[string]bool{"clone": true, "pull": true, "push": true, "status": true, "sync": true}

// noteVersionMismatch prints one line to stderr when this binary is not the
// build the server publishes. It stays silent whenever it cannot tell: a dev
// build without a version, a server without a distribution, a network error.
func noteVersionMismatch(cmd *cobra.Command, stderr io.Writer) {
	if !syncCommands[cmd.Name()] {
		return
	}
	local := version()
	if local == "unknown" {
		return
	}
	server := resolveServer()
	if server == "" {
		return
	}
	dist, err := memogit.FetchDistribution(cmd.Context(), server, 3*time.Second)
	if err != nil || dist.Version == local {
		return
	}
	fmt.Fprintf(stderr, "memogit: the server publishes memogit %s, this is %s; run `memogit self-update`\n", dist.Version, local)
}
