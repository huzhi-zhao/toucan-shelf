// Package memogit implements the memogit CLI: a bridge that syncs a memos
// knowledge base between the server DB and local Markdown files, using a real
// local git repo for version snapshots. It does not reimplement git or touch
// the memos server code — it only speaks the existing REST/Connect API.
package memogit

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	// MetaDir is the per-repo metadata directory, sibling to .git.
	MetaDir = ".memogit"
	// ConfigFile holds server URL + PAT.
	ConfigFile = "config.yaml"
	// StateFile is the legacy single-workspace baseline file, kept only so old
	// checkouts can be migrated to StateDir. See migrateLegacyLayout.
	StateFile = "sync-state.json"
	// StateDir holds one "<dir>.json" sync baseline per checked-out workspace.
	StateDir = "state"
	// WorkDir is the fallback name for the document subfolder when the
	// workspace has no usable title.
	WorkDir = "work"

	// EnvServer and EnvToken override the config file (useful for CI).
	EnvServer = "MEMOGIT_SERVER"
	EnvToken  = "MEMOGIT_TOKEN"
)

// Config is the on-disk .memogit/config.yaml. One checkout root holds the
// server credentials once and tracks any number of that account's knowledge
// bases, each checked out into its own subfolder.
type Config struct {
	// Server is the base URL of the memos instance, e.g. https://memos.example.com.
	Server string `yaml:"server"`
	// Token is a Personal Access Token (memos_pat_...).
	Token string `yaml:"token"`
	// Workspaces lists the knowledge bases cloned into this root, in clone
	// order. `pull`/`push`/`status` operate on all of them by default, or on one
	// selected by title.
	Workspaces []*WorkspaceConfig `yaml:"workspaces,omitempty"`

	// The fields below are the pre-multi-workspace layout, read only so that
	// migrateLegacyLayout can fold them into Workspaces. Never written back.
	LegacyWorkspace      string `yaml:"workspace,omitempty"`
	LegacyWorkspaceTitle string `yaml:"workspace_title,omitempty"`
	LegacyFilter         string `yaml:"filter,omitempty"`
}

// WorkspaceConfig is one checked-out knowledge base within the root.
type WorkspaceConfig struct {
	// Workspace is the resource name ("workspaces/{uid}") on the server.
	Workspace string `yaml:"workspace"`
	// Title is the human-readable workspace title, used to select this entry on
	// the command line and for display.
	Title string `yaml:"workspace_title"`
	// Dir is the checkout subfolder under the root, recorded at clone time so a
	// later server-side title change never orphans the local files. For a sparse
	// checkout (see Sparse) the content lives at the root itself, so Dir is ".".
	Dir string `yaml:"dir"`
	// Name is the identity key for this workspace: it names the sync-state file
	// (.memogit/state/<name>.json) and selects the entry on the command line.
	// Empty means "same as Dir", which is the case for every normal checkout; it
	// is set explicitly only for a sparse checkout, where Dir is "." and cannot
	// serve as a unique name.
	Name string `yaml:"name,omitempty"`
	// Sparse, when non-empty, is the server folder_path prefix this checkout maps
	// to its root: only memos under that folder are checked out, and the prefix is
	// stripped from every local path (and re-added on push). Empty = full checkout.
	Sparse string `yaml:"sparse,omitempty"`
	// Filter is an optional CEL clause applied on clone/pull for this workspace
	// (in addition to the implicit "own memos only" scoping), e.g. `"work" in tags`.
	Filter string `yaml:"filter,omitempty"`
}

// stateName returns the identity/state-file key for this workspace: the explicit
// Name when set (sparse checkouts), otherwise the content Dir.
func (w *WorkspaceConfig) stateName() string {
	if w.Name != "" {
		return w.Name
	}
	return w.Dir
}

// Find returns the configured workspace whose title matches (case-insensitively),
// falling back to a match on the checkout dir. It errors rather than guessing so
// a mistyped name never syncs the wrong knowledge base.
func (c *Config) Find(title string) (*WorkspaceConfig, error) {
	for _, ws := range c.Workspaces {
		if strings.EqualFold(ws.Title, title) || strings.EqualFold(ws.stateName(), title) {
			return ws, nil
		}
	}
	var have []string
	for _, ws := range c.Workspaces {
		have = append(have, ws.Title)
	}
	if len(have) == 0 {
		return nil, fmt.Errorf("no workspaces cloned yet; run `memogit clone <title>` first")
	}
	return nil, fmt.Errorf("workspace %q not cloned here (have: %v)", title, have)
}

// Select resolves the workspaces a command should act on: all of them when
// title is empty, otherwise exactly the named one.
func (c *Config) Select(title string) ([]*WorkspaceConfig, error) {
	if title != "" {
		ws, err := c.Find(title)
		if err != nil {
			return nil, err
		}
		return []*WorkspaceConfig{ws}, nil
	}
	if len(c.Workspaces) == 0 {
		return nil, fmt.Errorf("no workspaces cloned yet; run `memogit clone <title>` first")
	}
	return c.Workspaces, nil
}

// LoadConfig reads .memogit/config.yaml under root, then applies env overrides.
func LoadConfig(root string) (*Config, error) {
	cfg := &Config{}
	path := filepath.Join(root, MetaDir, ConfigFile)
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("read config: %w", err)
		}
		// Missing file is fine as long as env vars supply the values.
	} else if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}

	if v := os.Getenv(EnvServer); v != "" {
		cfg.Server = v
	}
	if v := os.Getenv(EnvToken); v != "" {
		cfg.Token = v
	}
	if cfg.Server == "" || cfg.Token == "" {
		return nil, fmt.Errorf("not configured: run `memogit login --server <url> --token <pat>` (or set %s/%s)", EnvServer, EnvToken)
	}
	return cfg, nil
}

// Save writes the config to .memogit/config.yaml under root, creating the
// metadata dir if needed.
func (c *Config) Save(root string) error {
	dir := filepath.Join(root, MetaDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	path := filepath.Join(dir, ConfigFile)
	// 0600: the file holds a token.
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}

// Adopt registers a workspace being cloned into root, and reports whether it is
// resuming an interrupted clone.
//
// The config entry alone does not mean "cloned": it is written before the first
// document is fetched, so a clone that dies partway (a failed download, a git
// error, Ctrl-C) leaves an entry with no sync-state file behind. Such an entry
// is retaken with this run's options instead of being reported as an existing
// checkout — otherwise the only way out is hand-editing config.yaml. The
// sync-state file is the real "cloned" marker: once it exists, cloning again is
// refused and `memogit pull` is the way forward.
func (c *Config) Adopt(root string, ws *WorkspaceConfig) (resumed bool, err error) {
	for i, existing := range c.Workspaces {
		if existing.Workspace != ws.Workspace {
			continue
		}
		if _, statErr := os.Stat(statePath(root, existing.stateName())); statErr == nil {
			return false, fmt.Errorf("workspace %q already cloned into %s/; use `memogit pull` to update", existing.Title, existing.Dir)
		}
		if err := c.checkNameFree(ws, i); err != nil {
			return false, err
		}
		c.Workspaces[i] = ws
		return true, nil
	}
	if err := c.checkNameFree(ws, -1); err != nil {
		return false, err
	}
	c.Workspaces = append(c.Workspaces, ws)
	return false, nil
}

// checkNameFree rejects a checkout name (and thus directory) already taken by
// another workspace. skip is the index of the entry being replaced, or -1.
func (c *Config) checkNameFree(ws *WorkspaceConfig, skip int) error {
	for i, existing := range c.Workspaces {
		if i == skip {
			continue
		}
		if strings.EqualFold(existing.stateName(), ws.stateName()) {
			return fmt.Errorf("name %q is already used by workspace %q", ws.stateName(), existing.Title)
		}
	}
	return nil
}

// Migrate brings an older single-workspace checkout up to the multi-workspace
// layout. Commands call it right after LoadConfig; it is a no-op afterwards.
func Migrate(root string, cfg *Config) error {
	return migrateLegacyLayout(root, cfg)
}

// migrateLegacyLayout upgrades a pre-multi-workspace checkout in place: the
// single top-level workspace in config.yaml becomes the first Workspaces entry
// and .memogit/sync-state.json moves to .memogit/state/<dir>.json. It is a
// no-op once migrated, so commands can call it unconditionally. The on-disk
// document folder is unchanged — it was already <root>/<title>/.
func migrateLegacyLayout(root string, cfg *Config) error {
	if cfg.LegacyWorkspace == "" {
		return nil
	}
	ws := &WorkspaceConfig{
		Workspace: cfg.LegacyWorkspace,
		Title:     cfg.LegacyWorkspaceTitle,
		Dir:       workspaceDir(cfg.LegacyWorkspaceTitle),
		Filter:    cfg.LegacyFilter,
	}
	cfg.LegacyWorkspace, cfg.LegacyWorkspaceTitle, cfg.LegacyFilter = "", "", ""

	alreadyListed := false
	for _, existing := range cfg.Workspaces {
		if existing.Workspace == ws.Workspace {
			alreadyListed = true
			break
		}
	}
	if !alreadyListed {
		cfg.Workspaces = append([]*WorkspaceConfig{ws}, cfg.Workspaces...)
	}

	// Move the old baseline into the per-workspace location, unless the new one
	// already exists (in which case the old file is stale leftovers).
	oldState := filepath.Join(root, MetaDir, StateFile)
	newState := statePath(root, ws.Dir)
	if _, err := os.Stat(oldState); err == nil {
		if _, err := os.Stat(newState); os.IsNotExist(err) {
			if err := os.MkdirAll(filepath.Dir(newState), 0o755); err != nil {
				return fmt.Errorf("create %s: %w", filepath.Dir(newState), err)
			}
			if err := os.Rename(oldState, newState); err != nil {
				return fmt.Errorf("migrate sync state: %w", err)
			}
		}
	}
	return cfg.Save(root)
}

// workspaceDir picks the checkout subfolder name for a workspace title.
func workspaceDir(title string) string {
	if dir := sanitizeSegment(title); dir != "" {
		return dir
	}
	return WorkDir
}
