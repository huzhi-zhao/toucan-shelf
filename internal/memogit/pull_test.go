package memogit

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// A memo that exists on the server but never made it into the baseline must be
// adopted by the full-listing reconcile. The incremental filter only looks
// forward from last_sync, so a memo last updated before the watermark (e.g. one
// created on the web while a push moved the watermark past it) is invisible to
// every future pull; the full listing is what closes that gap.
//
// A nil client is safe here: attachment-less memos never reach a download.
func TestReconcileAdoptsUntrackedMemo(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}

	// Baseline tracks one memo; its file is on disk and unmodified.
	tracked := mkMemo("old1", "notes", "Existing", "body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["old1"] = trackedState

	// The server also has a memo the baseline has never seen.
	missed := mkMemo("new1", "consult", "FirstTalk", "meeting notes", v1pb.Memo_MARKDOWN)

	res := &PullResult{}
	err = reconcileAgainst(context.Background(), nil, ws, root,
		[]*v1pb.Memo{tracked, missed}, state, res, io.Discard)
	if err != nil {
		t.Fatal(err)
	}

	if res.Added != 1 {
		t.Errorf("Added = %d, want 1", res.Added)
	}
	if res.Removed != 0 || len(res.Orphaned) != 0 {
		t.Errorf("tracked memo disturbed: removed=%d orphaned=%v", res.Removed, res.Orphaned)
	}
	ms, ok := state.Memos["new1"]
	if !ok {
		t.Fatal("adopted memo missing from state")
	}
	wantPath := filepath.Join("consult", "FirstTalk.md")
	if ms.Path != wantPath {
		t.Fatalf("path = %q, want %q", ms.Path, wantPath)
	}
	data, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatalf("adopted memo not written to disk: %v", err)
	}
	if got := StripLocalID(string(data)); got != "meeting notes" {
		t.Errorf("content = %q", got)
	}
	if got := ParseLocalID(string(data)); got != "new1" {
		t.Errorf("adopted file carries marker %q, want new1", got)
	}
}

// Re-running the reconcile over an unchanged listing must be a no-op, so the
// adoption pass can't re-add memos it already tracks.
func TestReconcileAdoptionIsIdempotent(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	state := NewState("https://example.test")
	m := mkMemo("u1", "f", "Note", "x", v1pb.Memo_MARKDOWN)
	listing := []*v1pb.Memo{m}

	first := &PullResult{}
	if err := reconcileAgainst(context.Background(), nil, ws, root, listing, state, first, io.Discard); err != nil {
		t.Fatal(err)
	}
	second := &PullResult{}
	if err := reconcileAgainst(context.Background(), nil, ws, root, listing, state, second, io.Discard); err != nil {
		t.Fatal(err)
	}

	if first.Added != 1 {
		t.Errorf("first pass Added = %d, want 1", first.Added)
	}
	if second.Added != 0 || second.Updated != 0 || second.Removed != 0 {
		t.Errorf("second pass not a no-op: %+v", second)
	}
}

// Content that changed on the server before the incremental watermark is
// invisible to the updated_ts filter forever, which used to leave a document
// permanently reported as "to pull" while every pull found nothing to do. The
// full listing carries the server's content, so the reconcile pass closes it.
func TestReconcileAdoptsServerContentDrift(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}

	tracked := mkMemo("d1", "notes", "Doc", "original body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState

	// The server moved on, but its updated_ts predates the watermark.
	drifted := mkMemo("d1", "notes", "Doc", "rewritten on the web", v1pb.Memo_MARKDOWN)

	res := &PullResult{}
	if err := reconcileAgainst(context.Background(), nil, ws, root,
		[]*v1pb.Memo{drifted}, state, res, io.Discard); err != nil {
		t.Fatal(err)
	}

	if res.Updated != 1 {
		t.Errorf("Updated = %d, want 1", res.Updated)
	}
	data, err := os.ReadFile(filepath.Join(root, trackedState.Path))
	if err != nil {
		t.Fatal(err)
	}
	if got := StripLocalID(string(data)); got != "rewritten on the web" {
		t.Errorf("local file = %q, want the server version", got)
	}
	if state.Memos["d1"].ContentHash != CanonicalHash("rewritten on the web") {
		t.Error("baseline not advanced to the server content")
	}
}

// The same drift, but with local edits too, is a real conflict: the local file
// must survive untouched and the server version arrive as a sidecar.
func TestReconcileDriftWithLocalEditsConflicts(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}

	tracked := mkMemo("d1", "notes", "Doc", "original body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState
	if err := writeFile(root, trackedState.Path, InjectLocalID("my local edit", "d1", "MARKDOWN")); err != nil {
		t.Fatal(err)
	}

	drifted := mkMemo("d1", "notes", "Doc", "their server edit", v1pb.Memo_MARKDOWN)
	res := &PullResult{}
	if err := reconcileAgainst(context.Background(), nil, ws, root,
		[]*v1pb.Memo{drifted}, state, res, io.Discard); err != nil {
		t.Fatal(err)
	}

	if len(res.Conflicts) != 1 {
		t.Fatalf("Conflicts = %v, want one", res.Conflicts)
	}
	data, err := os.ReadFile(filepath.Join(root, trackedState.Path))
	if err != nil {
		t.Fatal(err)
	}
	if got := StripLocalID(string(data)); got != "my local edit" {
		t.Errorf("local edit was overwritten: %q", got)
	}
	if !conflictSidecarExists(root, trackedState.Path) {
		t.Error("server version was not written as a .remote sidecar")
	}
}
