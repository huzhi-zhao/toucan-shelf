package memogit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRepoConfigYAML(t *testing.T) {
	repo := t.TempDir()
	path := filepath.Join(repo, RepoConfigFile)
	writeTestFile(t, path, `
server: https://toucan.example.com
knowledge_bases:
  - name: Career
    desc: 职业规划
  - name: SideProjects
    attachments: false
  - name: Old
    enabled: false
`)
	rc, warnings, err := LoadRepoConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if rc.Root() != filepath.Join(repo, "kb") || rc.CheckoutDir() != "kb" || rc.Base() != repo {
		t.Fatalf("default checkout root: base=%s root=%s", rc.Base(), rc.Root())
	}
	kbs := rc.KnowledgeBases
	if len(kbs) != 3 || kbs[0].Desc != "职业规划" || !kbs[0].WantsAttachments() || kbs[1].WantsAttachments() || kbs[2].IsEnabled() || !kbs[0].IsEnabled() {
		t.Fatalf("unexpected entries: %+v", kbs)
	}
}

// The JSON a downstream repo wrote for its own script loads as-is; the key for
// building memogit in place is reported and ignored.
func TestLoadRepoConfigJSONWithLegacyKey(t *testing.T) {
	repo := t.TempDir()
	path := filepath.Join(repo, RepoConfigFile)
	writeTestFile(t, path, `{
  "server": "https://toucan.example.com",
  "memogit_source": "https://github.com/huzhi-zhao/toucan-shelf.git",
  "dir": "notes",
  "knowledge_bases": [{"name": "Career", "desc": "x", "attachments": false}]
}`)
	rc, warnings, err := LoadRepoConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "memogit_source") {
		t.Fatalf("expected a warning about memogit_source, got %v", warnings)
	}
	if rc.Root() != filepath.Join(repo, "notes") || rc.KnowledgeBases[0].WantsAttachments() {
		t.Fatalf("unexpected config: %+v", rc)
	}
}

func TestLoadRepoConfigRequiresNames(t *testing.T) {
	path := filepath.Join(t.TempDir(), RepoConfigFile)
	writeTestFile(t, path, "knowledge_bases:\n  - desc: nameless\n")
	if _, _, err := LoadRepoConfig(path); err == nil {
		t.Fatal("expected an error for an entry without a name")
	}
}

func TestFindRootThroughRepoConfig(t *testing.T) {
	repo := t.TempDir()
	writeTestFile(t, filepath.Join(repo, RepoConfigFile), "knowledge_bases:\n  - name: Career\n")
	sub := filepath.Join(repo, "docs", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	// Before the first sync there is no checkout to find.
	if _, err := FindRoot(sub); err == nil {
		t.Fatal("expected no root before kb/.memogit exists")
	}

	if err := os.MkdirAll(filepath.Join(repo, "kb", MetaDir), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, from := range []string{repo, sub, filepath.Join(repo, "kb")} {
		got, err := FindRoot(from)
		if err != nil || got != filepath.Join(repo, "kb") {
			t.Fatalf("FindRoot(%s) = %q, %v", from, got, err)
		}
	}
	if got := FindRepoConfig(sub); got != filepath.Join(repo, RepoConfigFile) {
		t.Fatalf("FindRepoConfig = %q", got)
	}
}

func TestTrackedWorkspaceMatchesTitleCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{Workspaces: []*WorkspaceConfig{
		{Workspace: "workspaces/a", Title: "Life", Dir: "Life"},
		{Workspace: "workspaces/b", Title: "Career", Dir: "Career"},
	}}
	writeTestFile(t, statePath(root, "Life"), "{}")
	// Career has a config entry but no sync state: an interrupted clone.

	if ws := trackedWorkspace(root, cfg, "life"); ws == nil || ws.Dir != "Life" {
		t.Fatalf("expected `life` to match the checked-out `Life`, got %+v", ws)
	}
	if ws := trackedWorkspace(root, cfg, "Career"); ws != nil {
		t.Fatalf("an interrupted clone must not count as checked out, got %+v", ws)
	}
	if ws := trackedWorkspace(root, cfg, "Missing"); ws != nil {
		t.Fatalf("got %+v", ws)
	}
}
