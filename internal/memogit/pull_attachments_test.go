package memogit

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// attachmentServer serves every attachment download with fixed bytes and counts
// the requests.
func attachmentServer(t *testing.T) (*Client, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("png-bytes"))
	}))
	t.Cleanup(srv.Close)
	return NewClient(&Config{Server: srv.URL, Token: "t"}), &hits
}

func withAttachment(m *v1pb.Memo) *v1pb.Memo {
	m.Attachments = []*v1pb.Attachment{{Name: "attachments/a1", Filename: "chart.png", Type: "image/png", Size: int64(len("png-bytes"))}}
	return m
}

// An attachment added on the web leaves content and path unchanged, so the
// hash checks used to pass the document over and the bytes never arrived.
func TestReconcileDownloadsAttachmentOnlyChange(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	client, hits := attachmentServer(t)

	tracked := mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, nil, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState

	server := withAttachment(mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN))
	res := &PullResult{}
	if err := reconcileAgainst(context.Background(), client, ws, nil, root, []*v1pb.Memo{server}, state, res, io.Discard, nil); err != nil {
		t.Fatal(err)
	}

	if res.Updated != 1 || res.Attachments != 1 {
		t.Fatalf("Updated=%d Attachments=%d, want 1 and 1", res.Updated, res.Attachments)
	}
	refs := state.Memos["d1"].Attachments
	if len(refs) != 1 {
		t.Fatalf("baseline refs = %+v, want the new attachment", refs)
	}
	if _, err := os.Stat(filepath.Join(root, refs[0].Path)); err != nil {
		t.Fatalf("attachment bytes not written: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(root, trackedState.Path))
	if !strings.Contains(string(data), manifestKey) || !strings.Contains(string(data), refs[0].Path) {
		t.Errorf("manifest not written into the file:\n%s", data)
	}

	// A second pull with nothing new does no work.
	again := &PullResult{}
	if err := reconcileAgainst(context.Background(), client, ws, nil, root, []*v1pb.Memo{server}, state, again, io.Discard, nil); err != nil {
		t.Fatal(err)
	}
	if again.Updated != 0 || hits.Load() != 1 {
		t.Errorf("second pull: Updated=%d downloads=%d, want 0 and still 1", again.Updated, hits.Load())
	}
}

// Unpushed local edits must survive: only the manifest changes, and the file
// still reads as locally modified so push sends the edit.
func TestReconcileAttachmentChangeKeepsLocalEdits(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	client, _ := attachmentServer(t)

	tracked := mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, nil, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState
	if err := writeFile(root, trackedState.Path, InjectLocalID("my local edit", "d1", "MARKDOWN")); err != nil {
		t.Fatal(err)
	}

	server := withAttachment(mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN))
	if err := reconcileAgainst(context.Background(), client, ws, nil, root, []*v1pb.Memo{server}, state, &PullResult{}, io.Discard, nil); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(filepath.Join(root, trackedState.Path))
	if got := StripLocalID(string(data)); got != "my local edit" {
		t.Errorf("local edit lost: %q", got)
	}
	if !strings.Contains(string(data), manifestKey) {
		t.Error("manifest not added")
	}
	if localHash(data) == state.Memos["d1"].ContentHash {
		t.Error("the local edit must still read as unpushed")
	}
}

// An attachment removed on the web takes its local bytes and manifest entry
// with it.
func TestReconcileRemovesDroppedAttachment(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	client, _ := attachmentServer(t)

	withAtt := withAttachment(mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN))
	refs, _, err := downloadMemoAttachments(context.Background(), client, root, "notes/Doc.md", withAtt, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	trackedState, err := writeMemoDoc(ws, nil, root, withAtt, refs)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState

	server := mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	if err := reconcileAgainst(context.Background(), client, ws, nil, root, []*v1pb.Memo{server}, state, &PullResult{}, io.Discard, nil); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(root, refs[0].Path)); !os.IsNotExist(err) {
		t.Errorf("dropped attachment bytes still on disk (err=%v)", err)
	}
	data, _ := os.ReadFile(filepath.Join(root, trackedState.Path))
	if strings.Contains(string(data), manifestKey) {
		t.Errorf("manifest still lists the dropped attachment:\n%s", data)
	}
	if len(state.Memos["d1"].Attachments) != 0 {
		t.Errorf("baseline refs = %+v, want none", state.Memos["d1"].Attachments)
	}
}

// A checkout made with --no-attachments never downloads, whatever changes.
func TestReconcileAttachmentChangeHonorsNoAttachments(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{NoAttachments: true}
	client, hits := attachmentServer(t)

	tracked := mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	trackedState, err := writeMemoDoc(ws, nil, root, tracked, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["d1"] = trackedState

	server := withAttachment(mkMemo("d1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN))
	res := &PullResult{}
	if err := reconcileAgainst(context.Background(), client, ws, nil, root, []*v1pb.Memo{server}, state, res, io.Discard, nil); err != nil {
		t.Fatal(err)
	}
	if res.Updated != 0 || hits.Load() != 0 {
		t.Errorf("Updated=%d downloads=%d, want none", res.Updated, hits.Load())
	}
}
