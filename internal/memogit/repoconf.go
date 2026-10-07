package memogit

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"gopkg.in/yaml.v3"
)

// RepoConfigFile is the file a downstream repo keeps at its root to say which
// knowledge bases it checks out (see docs/skill/bootstrap.md). `memogit sync`
// and the `memogit hook` commands read it; every other command finds the
// checkout root through it when run from the repo instead of the checkout.
const RepoConfigFile = "memogit.conf.yaml"

// DefaultRepoCheckoutDir is the checkout root, relative to the repo, when the
// config does not set one.
const DefaultRepoCheckoutDir = "kb"

// RepoConfig is a downstream repo's memogit.conf.yaml. The schema is the one
// the first downstream repos wrote for their own sync scripts, kept so their
// files carry over unchanged (YAML also reads their JSON variant).
type RepoConfig struct {
	// Dir is the checkout root relative to the config file; default "kb".
	Dir string `yaml:"dir"`
	// Server is only a fallback for when no server is set in the environment
	// or the checkout's config.yaml.
	Server string `yaml:"server"`
	// KnowledgeBases lists what to check out, in order.
	KnowledgeBases []RepoKnowledgeBase `yaml:"knowledge_bases"`

	// base is the directory holding the config file.
	base string
}

// RepoKnowledgeBase is one entry of RepoConfig.KnowledgeBases.
type RepoKnowledgeBase struct {
	// Name is the workspace title on the server, matched case-insensitively.
	Name string `yaml:"name"`
	// Desc tells the agent what lives in this knowledge base; it is printed in
	// the session-start summary.
	Desc string `yaml:"desc"`
	// Attachments false checks out text only. Fixed at clone time. Default true.
	Attachments *bool `yaml:"attachments"`
	// Sparse is rejected by `memogit sync` (it would map one folder onto the
	// shared checkout root); kept only so that error can point at Folders.
	Sparse string `yaml:"sparse"`
	// Folders checks out only these server folders (each with its subfolders),
	// still under the knowledge base's own subfolder, e.g. kb/SideProjects/CMOP.
	// Empty checks out the whole knowledge base. Re-read on every sync, so the
	// list can grow or shrink without a re-clone.
	Folders []string `yaml:"folders"`
	// Filter is a CEL clause, e.g. `"work" in tags`.
	Filter string `yaml:"filter"`
	// Enabled false skips the entry without deleting it. Default true.
	Enabled *bool `yaml:"enabled"`
}

// IsEnabled reports whether the entry should be synced.
func (k RepoKnowledgeBase) IsEnabled() bool { return k.Enabled == nil || *k.Enabled }

// WantsAttachments reports whether attachment bytes should be downloaded.
func (k RepoKnowledgeBase) WantsAttachments() bool { return k.Attachments == nil || *k.Attachments }

// repoConfigKeys are the top-level keys RepoConfig understands. Anything else
// is reported once and ignored, so an old file never fails to load.
var repoConfigKeys = map[string]bool{"dir": true, "server": true, "knowledge_bases": true}

// LoadRepoConfig reads the memogit.conf.yaml at path. warnings lists keys it
// ignored (e.g. `memogit_source` from the era of building memogit in place).
func LoadRepoConfig(path string) (rc *RepoConfig, warnings []string, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("read %s: %w", path, err)
	}
	rc = &RepoConfig{}
	if err := yaml.Unmarshal(data, rc); err != nil {
		return nil, nil, fmt.Errorf("parse %s: %w", path, err)
	}
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err == nil {
		for k := range raw {
			if !repoConfigKeys[k] {
				warnings = append(warnings, fmt.Sprintf("%s: ignoring unknown key %q", RepoConfigFile, k))
			}
		}
		sort.Strings(warnings)
	}
	for i, kb := range rc.KnowledgeBases {
		if kb.Name == "" {
			return nil, nil, fmt.Errorf("%s: knowledge_bases[%d] has no name", path, i)
		}
	}
	abs, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return nil, nil, err
	}
	rc.base = abs
	return rc, warnings, nil
}

// FindRepoConfig looks for memogit.conf.yaml in dir and its parents and
// returns its path, or "" when there is none.
func FindRepoConfig(dir string) string {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	for {
		p := filepath.Join(abs, RepoConfigFile)
		if fi, err := os.Stat(p); err == nil && fi.Mode().IsRegular() {
			return p
		}
		parent := filepath.Dir(abs)
		if parent == abs {
			return ""
		}
		abs = parent
	}
}

// Base is the directory holding the config file (the downstream repo root).
func (c *RepoConfig) Base() string { return c.base }

// CheckoutDir is Dir as written, or the default.
func (c *RepoConfig) CheckoutDir() string {
	if c.Dir == "" {
		return DefaultRepoCheckoutDir
	}
	return c.Dir
}

// Root is the absolute path of the checkout root.
func (c *RepoConfig) Root() string {
	if filepath.IsAbs(c.CheckoutDir()) {
		return c.CheckoutDir()
	}
	return filepath.Join(c.base, c.CheckoutDir())
}
