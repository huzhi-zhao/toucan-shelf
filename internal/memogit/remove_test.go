package memogit

import (
	"os"
	"path/filepath"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestForgetDropsOnlyTheNamedWorkspace(t *testing.T) {
	keep := &WorkspaceConfig{Workspace: "workspaces/a", Title: "Alpha", Dir: "Alpha"}
	drop := &WorkspaceConfig{Workspace: "workspaces/b", Title: "Beta", Dir: "Beta"}
	cfg := &Config{Workspaces: []*WorkspaceConfig{keep, drop}}

	cfg.forget(drop)

	if len(cfg.Workspaces) != 1 || cfg.Workspaces[0] != keep {
		t.Fatalf("want only Alpha left, got %+v", cfg.Workspaces)
	}
}

// A sparse checkout shares its content root with the checkout metadata and any
// other workspace, so removal must take the baseline's own files and nothing
// else — never the whole directory.
func TestRemoveTrackedFilesLeavesUnrelatedFiles(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}

	mine := mkMemo("m1", "notes", "Mine", "body", v1pb.Memo_MARKDOWN)
	mineState, err := writeMemoDoc(ws, root, mine, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["m1"] = mineState

	other := filepath.Join(root, "other", "Theirs.md")
	if err := os.MkdirAll(filepath.Dir(other), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(other, []byte("not mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	n, err := removeTrackedFiles(root, state)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("removed %d files, want 1", n)
	}
	if _, err := os.Stat(filepath.Join(root, mineState.Path)); !os.IsNotExist(err) {
		t.Errorf("tracked file %s survived", mineState.Path)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("unrelated file was removed: %v", err)
	}
	// The emptied folder goes with its last file.
	if _, err := os.Stat(filepath.Join(root, "notes")); !os.IsNotExist(err) {
		t.Errorf("emptied folder %q survived", "notes")
	}
}

func TestCountFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "a", "b"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"one.md", filepath.Join("a", "two.md"), filepath.Join("a", "b", "three.md")} {
		if err := os.WriteFile(filepath.Join(root, p), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	n, err := countFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("counted %d, want 3", n)
	}

	// A folder that is already gone counts as empty rather than erroring, so the
	// summary never blocks a removal that has nothing left to do.
	if n, err := countFiles(filepath.Join(root, "missing")); err != nil || n != 0 {
		t.Errorf("missing dir: got %d, %v; want 0, nil", n, err)
	}
}
