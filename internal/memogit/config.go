// Package memogit implements the memogit CLI: a bridge that syncs a memos
// knowledge base between the server DB and local Markdown files, using a real
// local git repo for version snapshots. It does not reimplement git or touch
// the memos server code — it only speaks the existing REST/Connect API.
package memogit

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const (
	// MetaDir is the per-repo metadata directory, sibling to .git.
	MetaDir = ".memogit"
	// ConfigFile holds server URL + PAT.
	ConfigFile = "config.yaml"
	// StateFile records the last-synced baseline per memo.
	StateFile = "sync-state.json"
	// WorkDir is the fallback name for the document subfolder when the
	// workspace has no usable title.
	WorkDir = "work"

	// EnvServer and EnvToken override the config file (useful for CI).
	EnvServer = "MEMOGIT_SERVER"
	EnvToken  = "MEMOGIT_TOKEN"
)

// Config is the on-disk .memogit/config.yaml.
type Config struct {
	// Server is the base URL of the memos instance, e.g. https://memos.example.com.
	Server string `yaml:"server"`
	// Token is a Personal Access Token (memos_pat_...).
	Token string `yaml:"token"`
	// Workspace is the resource name ("workspaces/{uid}") of the knowledge base
	// this local checkout tracks. Set by `clone` and reused by `pull`/`push` so
	// a local repo always maps to exactly one server-side workspace.
	Workspace string `yaml:"workspace,omitempty"`
	// WorkspaceTitle is the human-readable title, kept for display only.
	WorkspaceTitle string `yaml:"workspace_title,omitempty"`
	// Filter is an optional CEL clause applied on clone/pull (in addition to the
	// implicit "own memos only" scoping), e.g. `"work" in tags`.
	Filter string `yaml:"filter,omitempty"`
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
