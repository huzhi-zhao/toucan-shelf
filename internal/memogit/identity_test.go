package memogit

import (
	"os"
	"path/filepath"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// mkState builds a baseline from "uid -> path" pairs.
func mkState(pairs map[string]string) *State {
	st := &State{Memos: map[string]MemoState{}}
	for uid, path := range pairs {
		st.Memos[uid] = MemoState{Path: path, DocType: "MARKDOWN", ContentHash: CanonicalHash("body of " + uid)}
	}
	return st
}

func resolved(docs []localDoc) map[string]string {
	out := make(map[string]string, len(docs))
	for _, d := range docs {
		out[d.Path] = d.UID
	}
	return out
}

// The point of the whole exercise: a file moved in the work tree keeps its
// identity, so push relocates the memo instead of archiving it and creating a
// new one (which would strand its history, comments and inbound links).
func TestResolveIdentitiesFollowsMovedFile(t *testing.T) {
	state := mkState(map[string]string{"uid1": "consult/notes.md"})
	docs := []localDoc{
		{Path: "research/consultations/2026-07-28.md", MarkerUID: "uid1", DocType: "MARKDOWN"},
	}
	resolveIdentities(docs, state)

	if docs[0].UID != "uid1" {
		t.Fatalf("moved file resolved to %q, want uid1", docs[0].UID)
	}
}

// Content changing at the same time as the move (in either order) must not
// matter — identity comes from the marker, never from comparing bytes.
func TestResolveIdentitiesMoveWithEdit(t *testing.T) {
	state := mkState(map[string]string{"uid1": "a/old.md"})
	docs := []localDoc{
		{Path: "b/new.md", Content: "completely rewritten", MarkerUID: "uid1", DocType: "MARKDOWN"},
	}
	resolveIdentities(docs, state)

	if docs[0].UID != "uid1" {
		t.Errorf("edited+moved file resolved to %q, want uid1", docs[0].UID)
	}
}

// Files written before markers existed still sync exactly as they used to.
func TestResolveIdentitiesFallsBackToPath(t *testing.T) {
	state := mkState(map[string]string{"uid1": "notes/keep.md"})
	docs := []localDoc{
		{Path: "notes/keep.md", DocType: "MARKDOWN"},      // tracked, no marker
		{Path: "notes/brand-new.md", DocType: "MARKDOWN"}, // untracked, no marker
	}
	resolveIdentities(docs, state)

	got := resolved(docs)
	if got["notes/keep.md"] != "uid1" {
		t.Errorf("unmarked tracked file resolved to %q, want uid1", got["notes/keep.md"])
	}
	if got["notes/brand-new.md"] != "" {
		t.Errorf("new file resolved to %q, want empty", got["notes/brand-new.md"])
	}
}

// A copied file carries a duplicate marker. That is a copy, not a move: the file
// still sitting where the memo lives keeps the identity, and the copy is pushed
// as a new document.
func TestResolveIdentitiesCopyDoesNotStealIdentity(t *testing.T) {
	state := mkState(map[string]string{"uid1": "notes/orig.md"})
	docs := []localDoc{
		{Path: "notes/copy.md", MarkerUID: "uid1", DocType: "MARKDOWN"},
		{Path: "notes/orig.md", MarkerUID: "uid1", DocType: "MARKDOWN"},
	}
	resolveIdentities(docs, state)

	got := resolved(docs)
	if got["notes/orig.md"] != "uid1" {
		t.Errorf("original lost its identity: %q", got["notes/orig.md"])
	}
	if got["notes/copy.md"] != "" {
		t.Errorf("copy claimed the identity: %q", got["notes/copy.md"])
	}
}

// Move plus a leftover file at the old path: the marker wins, and the stale file
// at the recorded path becomes a new document rather than hijacking the memo.
func TestResolveIdentitiesMarkerBeatsStalePath(t *testing.T) {
	state := mkState(map[string]string{"uid1": "old/doc.md"})
	docs := []localDoc{
		{Path: "new/doc.md", MarkerUID: "uid1", DocType: "MARKDOWN"},
		{Path: "old/doc.md", DocType: "MARKDOWN"}, // unrelated file left at the old path
	}
	resolveIdentities(docs, state)

	got := resolved(docs)
	if got["new/doc.md"] != "uid1" {
		t.Errorf("moved file resolved to %q, want uid1", got["new/doc.md"])
	}
	if got["old/doc.md"] != "" {
		t.Errorf("leftover at old path resolved to %q, want empty", got["old/doc.md"])
	}
}

// A marker pointing at a memo we no longer track (copied in from another
// checkout, or archived on the server) must not be trusted.
func TestResolveIdentitiesIgnoresUnknownMarker(t *testing.T) {
	state := mkState(map[string]string{"uid1": "notes/a.md"})
	docs := []localDoc{{Path: "notes/foreign.md", MarkerUID: "someone-elses-uid", DocType: "MARKDOWN"}}
	resolveIdentities(docs, state)

	if docs[0].UID != "" {
		t.Errorf("foreign marker resolved to %q, want empty", docs[0].UID)
	}
}

// The archive phase keys off identity, not paths: a moved file must never be
// counted as a deletion.
func TestMovedFileIsNotArchived(t *testing.T) {
	state := mkState(map[string]string{"uid1": "consult/notes.md"})
	docs := []localDoc{{Path: "research/notes.md", MarkerUID: "uid1", DocType: "MARKDOWN"}}
	resolveIdentities(docs, state)

	claimed := map[string]bool{}
	for _, d := range docs {
		if d.UID != "" {
			claimed[d.UID] = true
		}
	}
	if !claimed["uid1"] {
		t.Error("moved memo was left unclaimed and would be archived by push")
	}
}

// Deleting a file really does archive its memo — the fix must not break that.
func TestDeletedFileIsStillArchived(t *testing.T) {
	state := mkState(map[string]string{"uid1": "notes/gone.md"})
	docs := []localDoc{}
	resolveIdentities(docs, state)

	claimed := map[string]bool{}
	for _, d := range docs {
		claimed[d.UID] = true
	}
	if claimed["uid1"] {
		t.Error("a genuinely deleted document was claimed")
	}
}

// A document created during this very push must be claimed before the archive
// pass runs, or push creates it on the server and immediately archives it again.
func TestNewlyCreatedDocIsClaimed(t *testing.T) {
	state := mkState(nil)
	docs := []localDoc{{Path: "new/doc.md", DocType: "MARKDOWN"}}
	resolveIdentities(docs, state)
	if docs[0].UID != "" {
		t.Fatalf("a brand-new file resolved to %q, want empty", docs[0].UID)
	}

	// What Push does once the server hands back an identity.
	state.Memos["fresh1"] = MemoState{Path: "new/doc.md", DocType: "MARKDOWN"}
	docs[0].UID = "fresh1"

	if !claimedUIDs(docs)["fresh1"] {
		t.Error("freshly created document was left unclaimed and would be archived")
	}
}

func TestLoadLocalDocsStripsMarkers(t *testing.T) {
	root := t.TempDir()
	body := "# Note\n\nbody text"
	rel := filepath.Join("notes", "a.md")
	if err := writeFile(root, rel, InjectLocalID(body, "uid1", "MARKDOWN")); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(root, "plain.md", "no marker here"); err != nil {
		t.Fatal(err)
	}

	present, err := listDocFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := loadLocalDocs(root, present)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]localDoc{}
	for _, d := range docs {
		byPath[d.Path] = d
	}
	if got := byPath[rel]; got.MarkerUID != "uid1" || got.Content != body {
		t.Errorf("marked doc = %+v, want uid1 / %q", got, body)
	}
	if got := byPath["plain.md"]; got.MarkerUID != "" || got.Content != "no marker here" {
		t.Errorf("unmarked doc = %+v", got)
	}
}

// PDF stubs are generated, but they still carry an identity — otherwise moving
// one archives the PDF document and creates nothing in its place.
func TestPdfStubMoveKeepsIdentity(t *testing.T) {
	root := t.TempDir()
	state := &State{Memos: map[string]MemoState{
		"pdf1": {Path: filepath.Join("papers", "Paper.pdf.md"), DocType: "PDF"},
	}}
	// Simulate the user moving the stub to another folder.
	stub := InjectLocalID("<!-- memogit: PDF -->\n# Paper", "pdf1", "PDF")
	if err := writeFile(root, filepath.Join("archive", "Paper.pdf.md"), stub); err != nil {
		t.Fatal(err)
	}
	present, err := listDocFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := loadLocalDocs(root, present)
	if err != nil {
		t.Fatal(err)
	}
	resolveIdentities(docs, state)

	if len(docs) != 1 || docs[0].UID != "pdf1" {
		t.Fatalf("moved PDF stub resolved to %+v, want pdf1", docs)
	}
	if docs[0].DocType != "PDF" {
		t.Errorf("doc type = %q, want PDF", docs[0].DocType)
	}
	_ = os.Remove(filepath.Join(root, "archive", "Paper.pdf.md"))
}

// The server keeps the Home page's configuration in a reserved ".home" folder
// and hides it from the workspace tree. It must never be checked out: the work
// tree scanner skips dot-directories, so an exported ".home" file is invisible
// the moment it is written — and the next push reads that as "deleted locally"
// and archives the user's live Home document.
func TestHiddenServerFoldersAreNotCheckedOut(t *testing.T) {
	memos := []*v1pb.Memo{
		mkMemo("home1", ".home", "Home", "{}", v1pb.Memo_VIEW),
		mkMemo("doc1", "notes", "Keep", "body", v1pb.Memo_MARKDOWN),
	}
	got := inScopeMemos(&WorkspaceConfig{}, memos)
	if len(got) != 1 || uidFromName(got[0].GetName()) != "doc1" {
		t.Fatalf("in-scope memos = %v, want only doc1", got)
	}
}

func TestIsHiddenPath(t *testing.T) {
	hidden := []string{".home/Home.view.json", "a/.secret/b.md", ".dotfile.md"}
	visible := []string{"notes/a.md", "a/b/c.md", "research/2026-07-28.md"}
	for _, p := range hidden {
		if !isHiddenPath(p) {
			t.Errorf("isHiddenPath(%q) = false, want true", p)
		}
	}
	for _, p := range visible {
		if isHiddenPath(p) {
			t.Errorf("isHiddenPath(%q) = true, want false", p)
		}
	}
}

// A document archived on the web while its local file stays untouched used to be
// invisible to push: the hash matched the baseline, so push reported "unchanged"
// and never asked the server anything. The user kept pushing, kept seeing a
// clean run, and never learned the document was not published.
func TestArchivedOnServerIsReportedNotSilentlyUnchanged(t *testing.T) {
	state := mkState(map[string]string{"gone1": "research/talk.md", "live1": "research/keep.md"})
	docs := []localDoc{
		{Path: "research/keep.md", MarkerUID: "live1", DocType: "MARKDOWN"},
		{Path: "research/talk.md", MarkerUID: "gone1", DocType: "MARKDOWN"},
	}
	resolveIdentities(docs, state)

	// The server's live listing no longer contains the archived memo.
	alive := map[string]bool{"live1": true}

	var orphaned []string
	for _, d := range docs {
		if d.UID != "" && !alive[d.UID] {
			orphaned = append(orphaned, d.Path)
		}
	}
	if len(orphaned) != 1 || orphaned[0] != "research/talk.md" {
		t.Fatalf("orphaned = %v, want [research/talk.md]", orphaned)
	}

	// It must still count as claimed, so the archive pass leaves it alone rather
	// than trying to archive an already-archived memo.
	if !claimedUIDs(docs)["gone1"] {
		t.Error("archived-on-server document was unclaimed and would be re-archived")
	}
}
