package memogit

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestDocTypeFromExt(t *testing.T) {
	cases := map[string]string{
		"a/b/note.md":        "MARKDOWN",
		"page.html":          "HTML",
		"papers/x.pdf.md":    "PDF",
		"dash/all.view.json": "VIEW",
	}
	for path, want := range cases {
		if got := docTypeFromExt(path); got != want {
			t.Errorf("docTypeFromExt(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestStripDocExt(t *testing.T) {
	cases := map[string]string{
		"note.md":       "note",
		"page.html":     "page",
		"x.pdf.md":      "x",
		"all.view.json": "all",
		"noext":         "noext",
	}
	for in, want := range cases {
		if got := stripDocExt(in); got != want {
			t.Errorf("stripDocExt(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDeriveMemoFromPath(t *testing.T) {
	folder, title, dt := deriveMemoFromPath(filepath.Join("garden", "notes", "todo.md"))
	if folder != "garden/notes" || title != "todo" || dt != "MARKDOWN" {
		t.Errorf("got folder=%q title=%q dt=%q", folder, title, dt)
	}
	// Root-level file → empty folder_path.
	folder, title, dt = deriveMemoFromPath("dash.view.json")
	if folder != "" || title != "dash" || dt != "VIEW" {
		t.Errorf("root: got folder=%q title=%q dt=%q", folder, title, dt)
	}
}

func TestAttachmentRelPath(t *testing.T) {
	got := attachmentRelPath("attachments/abc123", "my file.pdf")
	want := filepath.Join(attachmentsDir, "abc123", "my file.pdf")
	if got != want {
		t.Errorf("attachmentRelPath = %q, want %q", got, want)
	}
}

func TestListDocFilesSkipsAttachmentsAndDotfiles(t *testing.T) {
	root := t.TempDir()
	must := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must("note.md", "x")
	must(filepath.Join("sub", "page.html"), "x")
	must(filepath.Join(attachmentsDir, "uid", "img.png"), "x") // must be skipped
	must(".hidden", "x")                                       // must be skipped

	got, err := listDocFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	want := []string{"note.md", filepath.Join("sub", "page.html")}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("listDocFiles = %v, want %v", got, want)
	}
}

func TestConflictSidecarHelpers(t *testing.T) {
	if got := conflictSidecarRel("a/b.md"); got != "a/b.md.remote" {
		t.Errorf("conflictSidecarRel = %q", got)
	}
	if !isConflictSidecar("x.md.remote") || isConflictSidecar("x.md") {
		t.Error("isConflictSidecar misclassified")
	}
	root := t.TempDir()
	if err := writeConflictSidecar(root, "n/todo.md", "server body"); err != nil {
		t.Fatal(err)
	}
	if !conflictSidecarExists(root, "n/todo.md") {
		t.Fatal("sidecar should exist after write")
	}
	// The sidecar must be skipped by the document scanner.
	docs, err := listDocFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range docs {
		if isConflictSidecar(d) {
			t.Errorf("listDocFiles returned a sidecar: %q", d)
		}
	}
	removeConflictSidecar(root, "n/todo.md")
	if conflictSidecarExists(root, "n/todo.md") {
		t.Error("sidecar should be gone after remove")
	}
}
