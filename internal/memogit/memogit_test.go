package memogit

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
	if got := scopedFilter("alice", ""); got != `creator == "users/alice"` {
		t.Errorf("no extra: got %q", got)
	}
	if got := scopedFilter("alice", `"work" in tags`); got != `(creator == "users/alice") && ("work" in tags)` {
		t.Errorf("with extra: got %q", got)
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
	if err := st.Save(root); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(root)
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
