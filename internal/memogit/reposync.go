package memogit

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// RepoSyncResult is one knowledge base's outcome in SyncRepo.
type RepoSyncResult struct {
	KB RepoKnowledgeBase
	// Dir is the content folder under the checkout root; "" when the knowledge
	// base never got cloned.
	Dir string
	// Cloned is true when this run made the first checkout.
	Cloned bool
	// Changed counts local files added, updated or removed by a pull.
	Changed int
	// Conflicts counts documents changed on both sides (left as *.remote).
	Conflicts int
	// Err is why this knowledge base could not be synced.
	Err error
}

// SyncRepo brings a downstream repo's checkout in line with its
// memogit.conf.yaml: every enabled knowledge base that is not checked out yet
// is cloned, every one that is gets pulled. One failure does not stop the
// others; it is reported in that knowledge base's result. The returned error
// is for problems that stop everything, such as missing credentials.
//
// detail receives the per-document output of clone/pull.
func SyncRepo(ctx context.Context, rc *RepoConfig, detail io.Writer) ([]RepoSyncResult, error) {
	root := rc.Root()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create %s: %w", root, err)
	}
	cfg, err := LoadConfigWithServer(root, rc.Server)
	if err != nil {
		return nil, err
	}
	if err := Migrate(root, cfg); err != nil {
		return nil, err
	}

	var results []RepoSyncResult
	for _, kb := range rc.KnowledgeBases {
		if !kb.IsEnabled() {
			continue
		}
		res := RepoSyncResult{KB: kb}
		if ws := trackedWorkspace(root, cfg, kb.Name); ws != nil {
			res.Dir = ws.Dir
			pulled, err := Pull(ctx, root, cfg, ws, detail)
			if err != nil {
				res.Err = err
			} else {
				res.Changed = pulled.Added + pulled.Updated + pulled.Removed
				res.Conflicts = len(pulled.Conflicts)
			}
		} else if kb.Sparse != "" {
			// A sparse checkout puts its folder at the checkout root itself,
			// which collides with the other knowledge bases sharing that root.
			res.Err = errors.New("sparse is not supported in " + RepoConfigFile + "; check the whole knowledge base out, or use `memogit clone --sparse-checkout --dir` for a standalone root")
		} else {
			res.Err = Clone(ctx, root, cfg, kb.Name, kb.Filter, "", false, !kb.WantsAttachments(), detail)
			res.Cloned = res.Err == nil
			if ws := trackedWorkspace(root, cfg, kb.Name); ws != nil {
				res.Dir = ws.Dir
			}
		}
		results = append(results, res)
	}
	return results, nil
}

// trackedWorkspace finds the checked-out knowledge base titled title (any
// case: a config written as `life` must match the server's `Life`), or nil.
// An entry without a sync-state file is an interrupted clone, not a checkout.
func trackedWorkspace(root string, cfg *Config, title string) *WorkspaceConfig {
	for _, ws := range cfg.Workspaces {
		if !strings.EqualFold(ws.Title, title) {
			continue
		}
		if _, err := os.Stat(statePath(root, ws.stateName())); err == nil {
			return ws
		}
	}
	return nil
}
