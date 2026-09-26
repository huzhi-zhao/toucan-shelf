package memogit

import (
	"os"
	"path/filepath"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The server addresses a sub-document by a reserved folder path keyed on the
// parent's uid. Mirroring that literally would give the checkout a tree of
// uid-named directories, so it is mapped to a folder beside the parent's file.
// These tests pin that mapping and its inverse, because push depends on being
// able to run it backwards.

func TestParentUIDFromSubDocFolder(t *testing.T) {
	cases := []struct {
		folder string
		uid    string
		ok     bool
	}{
		{"_sub/abc123", "abc123", true},
		{"/_sub/abc123/", "abc123", true},
		// Not sub-document paths: a bare prefix names no parent, a deeper path is
		// a nesting the server never creates, and an ordinary folder that merely
		// starts with the same letters is an ordinary folder.
		{"_sub", "", false},
		{"_sub/abc123/deeper", "", false},
		{"_subscriptions/notes", "", false},
		{"notes", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		uid, ok := ParentUIDFromSubDocFolder(tc.folder)
		if ok != tc.ok || uid != tc.uid {
			t.Errorf("ParentUIDFromSubDocFolder(%q) = (%q, %v), want (%q, %v)", tc.folder, uid, ok, tc.uid, tc.ok)
		}
	}
}

func TestSubDocLocalPathRoundTrip(t *testing.T) {
	parentRel := filepath.Join("notes", "Architecture.md")

	rel := SubDocRelPath(parentRel, "Failure modes")
	want := filepath.Join("notes", "Architecture.subdocs", "Failure modes.md")
	if rel != want {
		t.Fatalf("SubDocRelPath = %q, want %q", rel, want)
	}

	// push runs the mapping backwards to find out which document a file in a
	// ".subdocs" folder belongs to.
	got, ok := ParentRelFromSubDocPath(rel)
	if !ok || got != parentRel {
		t.Fatalf("ParentRelFromSubDocPath(%q) = (%q, %v), want (%q, true)", rel, got, ok, parentRel)
	}
}

func TestParentRelFromSubDocPathRejectsOrdinaryFiles(t *testing.T) {
	for _, rel := range []string{
		filepath.Join("notes", "Plain.md"),
		"RootLevel.md",
		filepath.Join("subdocs", "NotASuffix.md"), // a folder literally named "subdocs"
	} {
		if parent, ok := ParentRelFromSubDocPath(rel); ok {
			t.Errorf("ParentRelFromSubDocPath(%q) = (%q, true), want ok=false", rel, parent)
		}
	}
}

// A sub-document is written beside its parent's file; an ordinary document keeps
// the workspace mapping. Both go through one function so the two can never drift.
func TestLocalRelPathOfPlacesSubDocBesideParent(t *testing.T) {
	ws := &WorkspaceConfig{}
	parent := mkMemo("p1", "notes", "Architecture", "body", v1pb.Memo_MARKDOWN)
	subDoc := mkMemo("s1", SubDocFolderPath("p1"), "Failure modes", "detail", v1pb.Memo_MARKDOWN)

	parents := newParentIndex(ws, NewState("https://example.test"), []*v1pb.Memo{parent})

	if got, want := localRelPathOf(ws, parents, parent), filepath.Join("notes", "Architecture.md"); got != want {
		t.Errorf("parent path = %q, want %q", got, want)
	}
	if got, want := localRelPathOf(ws, parents, subDoc), filepath.Join("notes", "Architecture.subdocs", "Failure modes.md"); got != want {
		t.Errorf("sub-document path = %q, want %q", got, want)
	}
}

// A parent renamed or moved in the same run takes its sub-documents with it:
// the index is seeded from the baseline but overlaid with where this run's memos
// will land, so the sub-document is written beside the new file, not the old one.
func TestParentIndexPrefersThisRunsPath(t *testing.T) {
	ws := &WorkspaceConfig{}
	state := NewState("https://example.test")
	state.Memos["p1"] = MemoState{Path: filepath.Join("old", "Architecture.md")}

	moved := mkMemo("p1", "new", "Architecture", "body", v1pb.Memo_MARKDOWN)
	parents := newParentIndex(ws, state, []*v1pb.Memo{moved})

	subDoc := mkMemo("s1", SubDocFolderPath("p1"), "Failure modes", "detail", v1pb.Memo_MARKDOWN)
	want := filepath.Join("new", "Architecture.subdocs", "Failure modes.md")
	if got := localRelPathOf(ws, parents, subDoc); got != want {
		t.Errorf("sub-document path = %q, want %q", got, want)
	}
}

// An unknown parent (outside a sparse checkout, or not pulled yet) must not make
// the sub-document vanish: it falls back to mirroring the server path literally,
// which is ugly but keeps the content somewhere real.
func TestLocalRelPathOfFallsBackWhenParentUnknown(t *testing.T) {
	ws := &WorkspaceConfig{}
	subDoc := mkMemo("s1", SubDocFolderPath("missing"), "Orphan", "detail", v1pb.Memo_MARKDOWN)

	want := filepath.Join("_sub", "missing", "Orphan.md")
	if got := localRelPathOf(ws, parentIndex{}, subDoc); got != want {
		t.Errorf("fallback path = %q, want %q", got, want)
	}
}

// The whole point of the mapping: a pulled sub-document lands in a folder next
// to its parent's file, with its real content.
func TestWriteMemoDocPlacesSubDocOnDisk(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	parent := mkMemo("p1", "notes", "Architecture", "main line", v1pb.Memo_MARKDOWN)
	parents := newParentIndex(ws, NewState("https://example.test"), []*v1pb.Memo{parent})

	if _, err := writeMemoDoc(ws, parents, root, parent, nil); err != nil {
		t.Fatal(err)
	}
	subDoc := mkMemo("s1", SubDocFolderPath("p1"), "Failure modes", "the long tail", v1pb.Memo_MARKDOWN)
	ms, err := writeMemoDoc(ws, parents, root, subDoc, nil)
	if err != nil {
		t.Fatal(err)
	}

	want := filepath.Join("notes", "Architecture.subdocs", "Failure modes.md")
	if ms.Path != want {
		t.Fatalf("state path = %q, want %q", ms.Path, want)
	}
	data, err := os.ReadFile(filepath.Join(root, want))
	if err != nil {
		t.Fatal(err)
	}
	if body := StripLocalID(string(data)); body != "the long tail" {
		t.Errorf("file body = %q, want %q", body, "the long tail")
	}
}
