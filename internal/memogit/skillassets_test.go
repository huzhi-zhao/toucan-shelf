package memogit

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// TestSkillAssetsMatchSource guards against a forgotten
// scripts/sync-agent-skill-docs.sh: assets/skill/ (go:embed'd into the
// memogit binary, see GuideDir) is a generated mirror of docs/skill/, the
// source of truth for agent-facing operating rules. go has no build-time
// hook that re-runs the sync automatically, so this test is the actual
// enforcement — it fails loudly, at `go test` time, when the two have
// drifted apart instead of silently shipping stale instructions.
func TestSkillAssetsMatchSource(t *testing.T) {
	sourceDir := filepath.Join("..", "..", "docs", "skill")
	if _, err := os.Stat(sourceDir); err != nil {
		t.Skipf("docs/skill/ not found at %s (not a full repo checkout): %v", sourceDir, err)
	}

	source := map[string][]byte{}
	if err := filepath.WalkDir(sourceDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		source[filepath.ToSlash(rel)] = data
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	embedded := map[string][]byte{}
	if err := fs.WalkDir(guideRoot, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(guideRoot, path)
		if err != nil {
			return err
		}
		embedded[path] = data
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	const hint = "run ./scripts/sync-agent-skill-docs.sh to resync internal/memogit/assets/skill/ from docs/skill/"

	for name, want := range source {
		got, ok := embedded[name]
		switch {
		case !ok:
			t.Errorf("assets/skill/%s missing (present in docs/skill/); %s", name, hint)
		case !bytes.Equal(got, want):
			t.Errorf("assets/skill/%s is stale relative to docs/skill/%s; %s", name, name, hint)
		}
	}
	for name := range embedded {
		if _, ok := source[name]; !ok {
			t.Errorf("assets/skill/%s has no source in docs/skill/ (stale, removed upstream); %s", name, hint)
		}
	}
}
