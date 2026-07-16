package memogit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func mkMemo(uid, folder, title, content string, dt v1pb.Memo_DocType) *v1pb.Memo {
	return &v1pb.Memo{
		Name:       "memos/" + uid,
		FolderPath: folder,
		Title:      title,
		Content:    content,
		DocType:    dt,
		Visibility: v1pb.Visibility_PRIVATE,
	}
}

func TestExportMemoSidecarModel(t *testing.T) {
	root := t.TempDir()

	// A markdown memo whose content already has its OWN Obsidian frontmatter:
	// the file must hold it verbatim, with no second memogit frontmatter block.
	content := "---\nstatus: done\n---\n# Hello\n\nbody"
	m := mkMemo("abc", "garden/notes", "My Note", content, v1pb.Memo_MARKDOWN)

	ms, err := writeMemoDoc(root, m, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join("garden", "notes", "My Note.md")
	if ms.Path != wantPath {
		t.Fatalf("path = %q, want %q", ms.Path, wantPath)
	}
	data, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatal(err)
	}
	// Verbatim content + single trailing newline; no memogit frontmatter added.
	if string(data) != content+"\n" {
		t.Errorf("file content not verbatim:\n got %q\nwant %q", data, content+"\n")
	}
	// Baseline hash must match the file's on-disk bytes (canonical form).
	if CanonicalHash(string(data)) != ms.ContentHash {
		t.Errorf("baseline hash %q != file hash %q", ms.ContentHash, CanonicalHash(string(data)))
	}
	if ms.DocType != "MARKDOWN" || ms.Visibility != "PRIVATE" {
		t.Errorf("metadata mismatch: %+v", ms)
	}
}

func TestExportPdfWritesStub(t *testing.T) {
	root := t.TempDir()
	m := mkMemo("pdf1", "papers", "Paper", "", v1pb.Memo_PDF)
	m.Attachments = []*v1pb.Attachment{
		{Name: "attachments/a1", Filename: "paper.pdf", Type: "application/pdf"},
	}
	ms, err := writeMemoDoc(root, m, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ms.Path != filepath.Join("papers", "Paper.pdf.md") {
		t.Fatalf("path = %q", ms.Path)
	}
	data, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "paper.pdf") || !strings.Contains(string(data), "attachments/a1") {
		t.Errorf("pdf stub missing attachment reference:\n%s", data)
	}
}

func TestCheckPathCollisions(t *testing.T) {
	// Two distinct titles that sanitize to the same filename must be rejected.
	memos := []*v1pb.Memo{
		mkMemo("u1", "f", "a:b", "x", v1pb.Memo_MARKDOWN),
		mkMemo("u2", "f", "a?b", "y", v1pb.Memo_MARKDOWN),
	}
	if err := checkPathCollisions(memos, os.Stderr); err == nil {
		t.Fatal("expected collision error, got nil")
	}
	// Distinct paths are fine.
	ok := []*v1pb.Memo{
		mkMemo("u1", "f", "a", "x", v1pb.Memo_MARKDOWN),
		mkMemo("u2", "f", "b", "y", v1pb.Memo_MARKDOWN),
	}
	if err := checkPathCollisions(ok, os.Stderr); err != nil {
		t.Fatalf("unexpected collision: %v", err)
	}
}

func TestPruneEmptyDirs(t *testing.T) {
	root := t.TempDir()
	deep := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	pruneEmptyDirs(root, deep)
	// All empty dirs down to root should be gone, root preserved.
	if _, err := os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Errorf("empty dir 'a' should have been pruned")
	}
	if _, err := os.Stat(root); err != nil {
		t.Errorf("root must be preserved: %v", err)
	}
}
