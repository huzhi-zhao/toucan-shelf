package memogit

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestRelPath(t *testing.T) {
	tests := []struct {
		name       string
		folderPath string
		title      string
		docType    string
		want       string
	}{
		{
			name:       "markdown under a folder path",
			folderPath: "garden/notes",
			title:      "todo",
			docType:    "MARKDOWN",
			want:       filepath.Join("garden", "notes", "todo.md"),
		},
		{
			name:       "html keeps its extension",
			folderPath: "",
			title:      "Landing Page",
			docType:    "HTML",
			want:       "Landing Page.html",
		},
		{
			name:       "pdf stub extension",
			folderPath: "papers",
			title:      "Attention Is All You Need",
			docType:    "PDF",
			want:       filepath.Join("papers", "Attention Is All You Need.pdf.md"),
		},
		{
			name:       "view config json",
			folderPath: "dashboards",
			title:      "All Tasks",
			docType:    "VIEW",
			want:       filepath.Join("dashboards", "All Tasks.view.json"),
		},
		{
			name:       "cjk title preserved",
			folderPath: "工作",
			title:      "会议纪要",
			docType:    "MARKDOWN",
			want:       filepath.Join("工作", "会议纪要.md"),
		},
		{
			name:       "reserved chars sanitized, no traversal",
			folderPath: "../etc",
			title:      "a/b:c",
			docType:    "MARKDOWN",
			want:       filepath.Join("etc", "a-b-c.md"),
		},
		{
			name:       "empty title falls back",
			folderPath: "",
			title:      "",
			docType:    "MARKDOWN",
			want:       "untitled.md",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RelPath(tt.folderPath, tt.title, tt.docType); got != tt.want {
				t.Errorf("RelPath(%q,%q,%q) = %q, want %q", tt.folderPath, tt.title, tt.docType, got, tt.want)
			}
		})
	}
}

func TestSparseCheckoutPathMapping(t *testing.T) {
	full := &WorkspaceConfig{} // no sparse prefix
	sparse := &WorkspaceConfig{Sparse: "Home"}

	// inScope: full includes everything; sparse only the folder and below.
	scopeCases := []struct {
		ws     *WorkspaceConfig
		folder string
		want   bool
	}{
		{full, "anything", true},
		{full, "", true},
		{sparse, "Home", true},
		{sparse, "Home/Journal", true},
		{sparse, "Home/Journal/2024", true},
		{sparse, "", false},
		{sparse, "HomeWork", false}, // prefix-but-not-a-folder-boundary
		{sparse, "Other", false},
	}
	for _, c := range scopeCases {
		if got := c.ws.inScope(c.folder); got != c.want {
			t.Errorf("inScope(%q) with Sparse=%q = %v, want %v", c.folder, c.ws.Sparse, got, c.want)
		}
	}

	// LocalRelPath strips the prefix so files sit at the sparse root.
	if got := sparse.LocalRelPath("Home", "Index", "MARKDOWN"); got != "Index.md" {
		t.Errorf("LocalRelPath at folder root = %q, want %q", got, "Index.md")
	}
	if got := sparse.LocalRelPath("Home/Journal", "2024", "MARKDOWN"); got != filepath.Join("Journal", "2024.md") {
		t.Errorf("LocalRelPath nested = %q, want %q", got, filepath.Join("Journal", "2024.md"))
	}

	// Round-trip: stripping then re-adding the prefix recovers the server folder.
	roundTrip := []string{"Home", "Home/Journal", "Home/a/b/c"}
	for _, server := range roundTrip {
		local := sparse.stripSparse(server)
		if got := sparse.ServerFolderPath(local); got != server {
			t.Errorf("round-trip %q -> local %q -> %q, want %q", server, local, got, server)
		}
	}
	// Full checkout leaves folders untouched in both directions.
	if got := full.ServerFolderPath("a/b"); got != "a/b" {
		t.Errorf("full ServerFolderPath = %q, want %q", got, "a/b")
	}
}

func TestSparseSubdirPathMapping(t *testing.T) {
	sparse := &WorkspaceConfig{Sparse: "Home", SparseSubdir: true}

	// inScope is unaffected by SparseSubdir: still gated on the Sparse prefix.
	if !sparse.inScope("Home/Journal") {
		t.Error("inScope(Home/Journal) = false, want true")
	}
	if sparse.inScope("Other") {
		t.Error("inScope(Other) = true, want false")
	}

	// LocalRelPath keeps the mapped folder as a subdirectory instead of stripping it.
	if got := sparse.LocalRelPath("Home", "Index", "MARKDOWN"); got != filepath.Join("Home", "Index.md") {
		t.Errorf("LocalRelPath at folder root = %q, want %q", got, filepath.Join("Home", "Index.md"))
	}
	if got := sparse.LocalRelPath("Home/Journal", "2024", "MARKDOWN"); got != filepath.Join("Home", "Journal", "2024.md") {
		t.Errorf("LocalRelPath nested = %q, want %q", got, filepath.Join("Home", "Journal", "2024.md"))
	}

	// ServerFolderPath is the identity: the local folder already is the server folder_path.
	for _, folder := range []string{"Home", "Home/Journal", "Home/a/b/c"} {
		if got := sparse.ServerFolderPath(folder); got != folder {
			t.Errorf("ServerFolderPath(%q) = %q, want %q (identity)", folder, got, folder)
		}
	}
}

func TestSanitizeFolderPathNoTraversal(t *testing.T) {
	// A malicious folder path must never escape the repo root.
	got := sanitizeFolderPath("../../secret/../x")
	if filepath.IsAbs(got) || got == "" && false {
		t.Fatalf("unexpected: %q", got)
	}
	if got != "secret/x" {
		t.Errorf("sanitizeFolderPath = %q, want %q", got, "secret/x")
	}
}

func TestCanonicalHashIgnoresTrailingNewlines(t *testing.T) {
	if CanonicalHash("hello") != CanonicalHash("hello\n\n") {
		t.Errorf("canonical hash should ignore trailing newlines")
	}
	if CanonicalHash("hello") == CanonicalHash("hello world") {
		t.Errorf("distinct content must hash differently")
	}
}

func TestScopedFilter(t *testing.T) {
	user := syncScope{Username: "alice"}
	if got := scopedFilter(user, ""); got != `creator == "users/alice"` {
		t.Errorf("no extra: got %q", got)
	}
	if got := scopedFilter(user, `"work" in tags`); got != `(creator == "users/alice") && ("work" in tags)` {
		t.Errorf("with extra: got %q", got)
	}

	// An admin syncs the whole workspace: no authorship clause, so a document
	// created by another account (or by a second account of their own) is still
	// checked out, pulled and pushed.
	admin := syncScope{Username: "alice", Admin: true}
	if got := scopedFilter(admin, ""); got != "" {
		t.Errorf("admin, no extra: want empty filter, got %q", got)
	}
	if got := scopedFilter(admin, `"work" in tags`); got != `"work" in tags` {
		t.Errorf("admin, with extra: got %q", got)
	}
}

func TestScopeOf(t *testing.T) {
	if got := scopeOf(&v1pb.User{Username: "alice", Role: v1pb.User_USER}); got.Admin || got.Username != "alice" {
		t.Errorf("plain user: got %+v", got)
	}
	if got := scopeOf(&v1pb.User{Username: "root", Role: v1pb.User_ADMIN}); !got.Admin {
		t.Errorf("admin: got %+v", got)
	}
}

func TestAndFilter(t *testing.T) {
	// An unfiltered admin must not produce a dangling "() && (...)".
	if got := andFilter("", "updated_ts > timestamp(1)"); got != "updated_ts > timestamp(1)" {
		t.Errorf("empty scope: got %q", got)
	}
	if got := andFilter(`creator == "users/alice"`, "x"); got != `(creator == "users/alice") && (x)` {
		t.Errorf("with scope: got %q", got)
	}
}

func TestStateSaveLoadAndPathIndex(t *testing.T) {
	root := t.TempDir()
	st := NewState("https://example.com")
	st.LastSync = time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	st.Memos["u1"] = MemoState{
		Path:        "garden/todo.md",
		DocType:     "MARKDOWN",
		Visibility:  "PRIVATE",
		Pinned:      true,
		Relations:   []string{"u2"},
		UpdateTime:  st.LastSync,
		ContentHash: "sha256:aa",
	}
	if err := st.Save(root, "garden"); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(root, "garden")
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != st.Server || !got.LastSync.Equal(st.LastSync) {
		t.Errorf("header mismatch: %+v", got)
	}
	m, ok := got.Memos["u1"]
	if !ok || m.ContentHash != "sha256:aa" || m.Path != "garden/todo.md" || m.DocType != "MARKDOWN" || !m.Pinned {
		t.Errorf("memo state mismatch: %+v", got.Memos)
	}
	idx := got.PathIndex()
	if idx["garden/todo.md"] != "u1" {
		t.Errorf("path index mismatch: %v", idx)
	}
}

func TestMigrateLegacyLayout(t *testing.T) {
	root := t.TempDir()
	meta := filepath.Join(root, MetaDir)
	if err := os.MkdirAll(meta, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := "server: https://example.com\ntoken: memos_pat_x\n" +
		"workspace: workspaces/abc\nworkspace_title: MPNP\n"
	if err := os.WriteFile(filepath.Join(meta, ConfigFile), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(meta, StateFile), []byte(`{"server":"https://example.com","memos":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(root, cfg); err != nil {
		t.Fatal(err)
	}

	if len(cfg.Workspaces) != 1 {
		t.Fatalf("want 1 migrated workspace, got %d", len(cfg.Workspaces))
	}
	ws := cfg.Workspaces[0]
	if ws.Workspace != "workspaces/abc" || ws.Title != "MPNP" || ws.Dir != "MPNP" {
		t.Errorf("migrated workspace mismatch: %+v", ws)
	}
	// The baseline moved to the per-workspace path, and the legacy file is gone.
	if _, err := os.Stat(statePath(root, "MPNP")); err != nil {
		t.Errorf("state not migrated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(meta, StateFile)); !os.IsNotExist(err) {
		t.Errorf("legacy state file should be gone, got %v", err)
	}
	// Re-loading sees the new layout and migration is a no-op.
	reloaded, err := LoadConfig(root)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.LegacyWorkspace != "" {
		t.Errorf("legacy field persisted: %q", reloaded.LegacyWorkspace)
	}
	if len(reloaded.Workspaces) != 1 || reloaded.Workspaces[0].Dir != "MPNP" {
		t.Errorf("reloaded workspaces mismatch: %+v", reloaded.Workspaces)
	}
}

func TestConfigSelectAndAdd(t *testing.T) {
	cfg := &Config{Workspaces: []*WorkspaceConfig{
		{Workspace: "workspaces/a", Title: "MPNP", Dir: "MPNP"},
		{Workspace: "workspaces/b", Title: "Wuxia", Dir: "Wuxia"},
	}}

	// No title selects every knowledge base.
	all, err := cfg.Select("")
	if err != nil || len(all) != 2 {
		t.Fatalf("select all: %v %d", err, len(all))
	}
	// A title selects exactly one, case-insensitively.
	one, err := cfg.Select("wuxia")
	if err != nil || len(one) != 1 || one[0].Workspace != "workspaces/b" {
		t.Fatalf("select by title: %v %+v", err, one)
	}
	// An unknown title is an error, never a silent fallback to another KB.
	if _, err := cfg.Select("Nope"); err == nil {
		t.Error("want error selecting an uncloned workspace")
	}
	// A workspace with a baseline on disk is really cloned: re-cloning is refused.
	root := t.TempDir()
	if err := NewState("https://example.com").Save(root, "MPNP"); err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.Adopt(root, &WorkspaceConfig{Workspace: "workspaces/a", Title: "MPNP", Dir: "MPNP"}); err == nil {
		t.Error("want error re-cloning a workspace that has a sync state")
	}
	// Another workspace may not take a directory that is already in use.
	if _, err := cfg.Adopt(root, &WorkspaceConfig{Workspace: "workspaces/c", Title: "Other", Dir: "MPNP"}); err == nil {
		t.Error("want error adopting a workspace with a taken directory")
	}
	if _, err := cfg.Adopt(root, &WorkspaceConfig{Workspace: "workspaces/c", Title: "Other", Dir: "Other"}); err != nil {
		t.Errorf("adopting a fresh workspace: %v", err)
	}
}

// An interrupted clone leaves a config entry with no sync state. Re-running
// clone must retake that entry (with this run's options) instead of dead-ending
// the user into hand-editing config.yaml.
func TestAdoptResumesInterruptedClone(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{Workspaces: []*WorkspaceConfig{
		{Workspace: "workspaces/a", Title: "PACE_AI", Dir: "PACE_AI"},
	}}
	resumed, err := cfg.Adopt(root, &WorkspaceConfig{
		Workspace: "workspaces/a", Title: "PACE_AI", Dir: "PACE_AI", Filter: `"work" in tags`,
	})
	if err != nil || !resumed {
		t.Fatalf("want a resumed adopt, got resumed=%v err=%v", resumed, err)
	}
	if len(cfg.Workspaces) != 1 {
		t.Fatalf("want the entry retaken in place, got %d entries", len(cfg.Workspaces))
	}
	if cfg.Workspaces[0].Filter != `"work" in tags` {
		t.Errorf("this run's options were not applied: %+v", cfg.Workspaces[0])
	}
}

func TestWriteFileNormalizesTrailingNewline(t *testing.T) {
	root := t.TempDir()
	if err := writeFile(root, "a/b.md", "content\n\n\n"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "a", "b.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "content\n" {
		t.Errorf("got %q, want %q", data, "content\n")
	}
}
