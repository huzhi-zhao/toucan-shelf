package memogit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The embedded copy must not drift from the manual humans edit.
func TestEmbeddedGuideMatchesManual(t *testing.T) {
	want, err := os.ReadFile(filepath.Join("..", "..", "docs", "manual", "pumpkin_book_for_llms.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != guideDoc {
		t.Fatalf("assets/pumpkin_book_for_llms.md is out of sync with docs/manual/pumpkin_book_for_llms.md;\n" +
			"run: cp docs/manual/pumpkin_book_for_llms.md internal/memogit/assets/")
	}
}

func TestWriteAgentDocs(t *testing.T) {
	root := t.TempDir()
	if err := WriteAgentDocs(root, nil, nil); err != nil {
		t.Fatal(err)
	}

	guide := read(t, filepath.Join(root, MetaDir, GuideFile))
	if guide != guideDoc {
		t.Errorf("guide content mismatch")
	}
	for _, name := range []string{"AGENTS.md", "CLAUDE.md", filepath.Join(".cursor", "rules", "toucanshelf-memogit.mdc")} {
		got := read(t, filepath.Join(root, name))
		if !strings.Contains(got, MetaDir+"/"+GuideFile) {
			t.Errorf("%s does not point at the guide:\n%s", name, got)
		}
	}
	if got := read(t, filepath.Join(root, ".cursor", "rules", "toucanshelf-memogit.mdc")); !strings.HasPrefix(got, "---\n") {
		t.Errorf("cursor rule is missing its frontmatter:\n%s", got)
	}
}

func TestWriteAgentDocsPreservesUserText(t *testing.T) {
	root := t.TempDir()
	agents := filepath.Join(root, "AGENTS.md")
	if err := os.WriteFile(agents, []byte("# 我的规则\n\n用中文回答。\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteAgentDocs(root, nil, nil); err != nil {
		t.Fatal(err)
	}
	// Regenerating must be idempotent and must not duplicate the block.
	if err := WriteAgentDocs(root, nil, nil); err != nil {
		t.Fatal(err)
	}

	got := read(t, agents)
	if !strings.Contains(got, "用中文回答。") {
		t.Errorf("user text was lost:\n%s", got)
	}
	if n := strings.Count(got, agentBlockBegin); n != 1 {
		t.Errorf("expected exactly 1 managed block, got %d:\n%s", n, got)
	}
	if !strings.Contains(got, "memogit-id") {
		t.Errorf("managed block missing:\n%s", got)
	}
}

// An agent is usually started inside one knowledge base, not at the checkout
// root, so each workspace folder needs its own entry points pointing up at the
// single guide — and push must not mistake them for documents.
func TestWriteAgentDocsPerWorkspace(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{Workspaces: []*WorkspaceConfig{
		{Title: "Default", Dir: "Default"},
		{Title: "Life", Dir: "Life"},
		{Title: "Sparse", Dir: "."}, // covered by the root files already
	}}
	if err := WriteAgentDocs(root, cfg, nil); err != nil {
		t.Fatal(err)
	}

	for _, dir := range []string{"Default", "Life"} {
		got := read(t, filepath.Join(root, dir, "AGENTS.md"))
		if !strings.Contains(got, "../"+MetaDir+"/"+GuideFile) {
			t.Errorf("%s/AGENTS.md does not link up to the guide:\n%s", dir, got)
		}
		if !strings.Contains(got, dir+"/`") {
			t.Errorf("%s/AGENTS.md does not say which knowledge base it is:\n%s", dir, got)
		}
		claude := read(t, filepath.Join(root, dir, "CLAUDE.md"))
		if !strings.Contains(claude, "../"+MetaDir+"/"+GuideFile) {
			t.Errorf("%s/CLAUDE.md does not link up to the guide:\n%s", dir, claude)
		}
		if _, err := os.Stat(filepath.Join(root, dir, ".cursor", "rules", "toucanshelf-memogit.mdc")); err != nil {
			t.Errorf("%s cursor rule: %v", dir, err)
		}
	}
	// The guide itself exists once, at the root.
	if _, err := os.Stat(filepath.Join(root, "Default", MetaDir)); !os.IsNotExist(err) {
		t.Errorf("workspace folder should not get its own %s dir", MetaDir)
	}
}

func TestListDocFilesSkipsAgentDocs(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"AGENTS.md", "CLAUDE.md", "real-note.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := listDocFiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "real-note.md" {
		t.Errorf("agent entry points must not be pushed as documents, got %v", got)
	}
}

func TestUpsertManagedBlockReplacesInPlace(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "AGENTS.md")
	if err := os.WriteFile(path, []byte("head\n\n"+agentBlockBegin+"\nold\n"+agentBlockEnd+"\n\ntail\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := upsertManagedBlock(path, "new\n"); err != nil {
		t.Fatal(err)
	}
	got := read(t, path)
	if strings.Contains(got, "old") {
		t.Errorf("stale block kept:\n%s", got)
	}
	if !strings.Contains(got, "head") || !strings.Contains(got, "tail") || !strings.Contains(got, "new") {
		t.Errorf("unexpected result:\n%s", got)
	}
	if strings.Index(got, "new") > strings.Index(got, "tail") {
		t.Errorf("block moved out of place:\n%s", got)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}
