package memogit

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/proto/gen/api/v1/apiv1connect"
)

// attachFakeServer is the slice of the API attach touches: GetMemo, the
// instance storage setting, CreateAttachment, and the /file/ download route.
type attachFakeServer struct {
	apiv1connect.UnimplementedMemoServiceHandler
	apiv1connect.UnimplementedAttachmentServiceHandler
	apiv1connect.UnimplementedInstanceServiceHandler

	mu      sync.Mutex
	memos   map[string]*v1pb.Memo
	blobs   map[string][]byte // attachment name -> bytes
	creates []*v1pb.Attachment
	// failOn makes CreateAttachment reject this filename.
	failOn string
	// limitMB, when set, is served as the storage setting (as to an admin);
	// otherwise the setting is refused, as it is to everyone else.
	limitMB int64
}

func newAttachFakeServer(t *testing.T, memos ...*v1pb.Memo) (*attachFakeServer, string) {
	t.Helper()
	f := &attachFakeServer{memos: map[string]*v1pb.Memo{}, blobs: map[string][]byte{}}
	for _, m := range memos {
		f.memos[m.GetName()] = m
	}
	mux := http.NewServeMux()
	mux.Handle(apiv1connect.NewMemoServiceHandler(f))
	mux.Handle(apiv1connect.NewAttachmentServiceHandler(f))
	mux.Handle(apiv1connect.NewInstanceServiceHandler(f))
	mux.HandleFunc("/file/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/file/")
		name := rest[:strings.LastIndex(rest, "/")]
		f.mu.Lock()
		data, ok := f.blobs[name]
		f.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return f, srv.URL
}

func (f *attachFakeServer) GetMemo(_ context.Context, req *connect.Request[v1pb.GetMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.memos[req.Msg.GetName()]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("memo not found"))
	}
	return connect.NewResponse(m), nil
}

func (f *attachFakeServer) GetInstanceSetting(context.Context, *connect.Request[v1pb.GetInstanceSettingRequest]) (*connect.Response[v1pb.InstanceSetting], error) {
	if f.limitMB == 0 {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("admins only"))
	}
	return connect.NewResponse(&v1pb.InstanceSetting{Value: &v1pb.InstanceSetting_StorageSetting_{
		StorageSetting: &v1pb.InstanceSetting_StorageSetting{UploadSizeLimitMb: f.limitMB},
	}}), nil
}

func (f *attachFakeServer) CreateAttachment(_ context.Context, req *connect.Request[v1pb.CreateAttachmentRequest]) (*connect.Response[v1pb.Attachment], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	in := req.Msg.GetAttachment()
	f.creates = append(f.creates, in)
	if in.GetFilename() == f.failOn {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("file size exceeds the limit"))
	}
	m, ok := f.memos[in.GetMemo()]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("memo not found"))
	}
	att := &v1pb.Attachment{
		Name:     fmt.Sprintf("attachments/up%d", len(f.creates)),
		Filename: in.GetFilename(),
		Type:     in.GetType(),
		Size:     int64(len(in.GetContent())),
		Memo:     in.Memo,
		Origin:   in.GetOrigin(),
	}
	f.blobs[att.Name] = in.GetContent()
	m.Attachments = append(m.Attachments, att)
	return connect.NewResponse(att), nil
}

// attachCheckout is a one-knowledge-base checkout tracking the given memos,
// with a git repo so attach can commit.
func attachCheckout(t *testing.T, url string, memos ...*v1pb.Memo) (string, *Config) {
	t.Helper()
	t.Setenv("GIT_AUTHOR_NAME", "t")
	t.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "t")
	t.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")
	root := t.TempDir()
	ws := &WorkspaceConfig{Workspace: "workspaces/w1", Title: "KB", Dir: "KB"}
	cfg := &Config{Server: url, Token: "memos_pat_test", Workspaces: []*WorkspaceConfig{ws}}
	state := NewState(url)
	for _, m := range memos {
		ms, err := writeMemoDoc(ws, nil, ContentRoot(root, ws), m, nil)
		if err != nil {
			t.Fatal(err)
		}
		state.Memos[uidFromName(m.GetName())] = ms
	}
	if err := state.Save(root, ws.stateName()); err != nil {
		t.Fatal(err)
	}
	if err := GitInitIfNeeded(root); err != nil {
		t.Fatal(err)
	}
	if err := GitCommitAll(root, "baseline"); err != nil {
		t.Fatal(err)
	}
	return root, cfg
}

func writeLocal(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAttachPreviewUploadsNothing(t *testing.T) {
	f, url := newAttachFakeServer(t, fakeMemo("d1", "notes", "Doc", "body"))
	root, cfg := attachCheckout(t, url, f.memos["memos/d1"])
	src := writeLocal(t, t.TempDir(), "data.csv", "a,b\n1,2\n")

	var out bytes.Buffer
	_, err := Attach(context.Background(), root, cfg, filepath.Join(root, "KB", "notes", "Doc.md"), []string{src}, false, &out)
	if !errors.Is(err, ErrAttachNotConfirmed) {
		t.Fatalf("err = %v, want ErrAttachNotConfirmed", err)
	}
	if len(f.creates) != 0 {
		t.Fatalf("preview uploaded %d file(s)", len(f.creates))
	}
	for _, want := range []string{"notes/Doc.md", "data.csv (text/csv", "Already attached: (none)"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("plan missing %q:\n%s", want, out.String())
		}
	}
}

func TestAttachConfirmAddsAndSyncsLocalCopy(t *testing.T) {
	existing := withAttachment(fakeMemo("d1", "notes", "Doc", "body"))
	f, url := newAttachFakeServer(t, existing)
	f.blobs["attachments/a1"] = []byte("png-bytes")
	root, cfg := attachCheckout(t, url, existing)
	dir := t.TempDir()
	srcs := []string{writeLocal(t, dir, "data.csv", "a,b\n"), writeLocal(t, dir, "notes.txt", "hello")}

	res, err := Attach(context.Background(), root, cfg, filepath.Join(root, "KB", "notes", "Doc.md"), srcs, true, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Uploaded) != 2 || len(res.NotUploaded) != 0 {
		t.Fatalf("result = %+v", res)
	}
	for _, c := range f.creates {
		if c.GetMemo() != "memos/d1" || c.GetOrigin() != v1pb.AttachmentOrigin_MOUNTED {
			t.Errorf("create = memo %q origin %v, want memos/d1 MOUNTED", c.GetMemo(), c.GetOrigin())
		}
	}
	if got := len(f.memos["memos/d1"].GetAttachments()); got != 3 {
		t.Fatalf("server has %d attachments, want the existing one plus 2", got)
	}

	contentRoot := filepath.Join(root, "KB")
	state, err := LoadState(root, "KB")
	if err != nil {
		t.Fatal(err)
	}
	refs := state.Memos["d1"].Attachments
	if attachmentSetKey(refs) != attachmentSetKey(serverAttachmentRefs(f.memos["memos/d1"])) {
		t.Fatalf("baseline refs %+v do not match the server", refs)
	}
	for _, r := range refs {
		if _, err := os.Stat(filepath.Join(contentRoot, r.Path)); err != nil {
			t.Errorf("attachment %s not on disk: %v", r.Path, err)
		}
	}
	doc, _ := os.ReadFile(filepath.Join(contentRoot, "notes", "Doc.md"))
	if !strings.Contains(string(doc), "data.csv") || !strings.Contains(string(doc), "notes.txt") {
		t.Errorf("manifest not updated:\n%s", doc)
	}
	if localHash(doc) != state.Memos["d1"].ContentHash {
		t.Error("attach changed the document body as seen by push")
	}
	if out, _ := git(root, "status", "--porcelain"); strings.TrimSpace(out) != "" {
		t.Errorf("attach left uncommitted changes:\n%s", out)
	}
}

func TestAttachRejectsBeforeUploading(t *testing.T) {
	pdf := fakeMemo("p1", "", "Paper", "")
	pdf.DocType = v1pb.Memo_PDF
	f, url := newAttachFakeServer(t, withAttachment(fakeMemo("d1", "notes", "Doc", "body")), pdf)
	root, cfg := attachCheckout(t, url, f.memos["memos/d1"], pdf)
	f.limitMB = 1
	contentRoot := filepath.Join(root, "KB")
	doc := filepath.Join(contentRoot, "notes", "Doc.md")
	dir := t.TempDir()
	ok := writeLocal(t, dir, "ok.txt", "fine")
	other := filepath.Join(t.TempDir(), "ok.txt")
	if err := os.WriteFile(other, []byte("same name"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(ok, link); err != nil {
		t.Fatal(err)
	}
	big := writeLocal(t, dir, "big.bin", strings.Repeat("x", 2<<20))
	untracked := writeLocal(t, filepath.Join(contentRoot, "notes"), "New.md", "draft")

	cases := []struct {
		name  string
		doc   string
		files []string
		want  string
	}{
		{"same name already attached", doc, []string{writeLocal(t, dir, "chart.png", "png")}, "already has an attachment"},
		{"same name twice", doc, []string{ok, other}, "would both be attached"},
		{"pdf document", filepath.Join(contentRoot, "Paper.pdf.md"), []string{ok}, "PDF document"},
		{"not pushed yet", untracked, []string{ok}, "push"},
		{"symlink", doc, []string{link}, "not a regular file"},
		{"over the instance limit", doc, []string{ok, big}, "over the upload limit"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Attach(context.Background(), root, cfg, tc.doc, tc.files, true, &bytes.Buffer{})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
			if len(f.creates) != 0 {
				t.Fatalf("rejected run still uploaded %d file(s)", len(f.creates))
			}
		})
	}
}

// A server refusal partway keeps what already went up — undoing it would be a
// deletion — and says exactly which files did and did not make it.
func TestAttachStopsAtFirstFailureWithoutRollback(t *testing.T) {
	f, url := newAttachFakeServer(t, fakeMemo("d1", "notes", "Doc", "body"))
	root, cfg := attachCheckout(t, url, f.memos["memos/d1"])
	f.failOn = "b.txt"
	dir := t.TempDir()
	srcs := []string{writeLocal(t, dir, "a.txt", "a"), writeLocal(t, dir, "b.txt", "b"), writeLocal(t, dir, "c.txt", "c")}

	res, err := Attach(context.Background(), root, cfg, filepath.Join(root, "KB", "notes", "Doc.md"), srcs, true, &bytes.Buffer{})
	if err == nil {
		t.Fatal("want an error for the refused upload")
	}
	if strings.Join(res.Uploaded, ",") != "a.txt" || strings.Join(res.NotUploaded, ",") != "b.txt,c.txt" {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(err.Error(), "not uploaded: b.txt, c.txt") || !strings.Contains(err.Error(), "/memos/d1") {
		t.Errorf("error does not report the split or point at the app: %v", err)
	}
	if got := len(f.memos["memos/d1"].GetAttachments()); got != 1 {
		t.Fatalf("server has %d attachments, want only a.txt", got)
	}
	state, _ := LoadState(root, "KB")
	if refs := state.Memos["d1"].Attachments; len(refs) != 1 || refs[0].Filename != "a.txt" {
		t.Errorf("baseline refs = %+v, want a.txt recorded", refs)
	}
}

func TestTouchedAttachmentsReportsLocalChanges(t *testing.T) {
	contentRoot := t.TempDir()
	state := NewState("https://kb.example.com")
	keep := AttachmentRef{Name: "attachments/k", Filename: "keep.txt", Size: 4, Path: filepath.Join(attachmentsDir, "k", "keep.txt")}
	edit := AttachmentRef{Name: "attachments/e", Filename: "edit.txt", Size: 4, Path: filepath.Join(attachmentsDir, "e", "edit.txt")}
	gone := AttachmentRef{Name: "attachments/g", Filename: "gone.txt", Size: 4, Path: filepath.Join(attachmentsDir, "g", "gone.txt")}
	for _, r := range []AttachmentRef{keep, edit} {
		if err := os.MkdirAll(filepath.Join(contentRoot, filepath.Dir(r.Path)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeLocal(t, filepath.Join(contentRoot, attachmentsDir, "k"), "keep.txt", "same")
	writeLocal(t, filepath.Join(contentRoot, attachmentsDir, "e"), "edit.txt", "changed")
	state.Memos["d1"] = MemoState{Path: "Doc.md", Attachments: []AttachmentRef{keep, edit, gone}}

	got := touchedAttachments(&Config{Server: "https://kb.example.com"}, contentRoot, state)
	if len(got) != 2 {
		t.Fatalf("got %q, want the edited and the deleted file", got)
	}
	if !strings.Contains(got[0], "edit.txt modified") || !strings.Contains(got[1], "gone.txt deleted") ||
		!strings.Contains(got[0], "https://kb.example.com/memos/d1") {
		t.Errorf("got %q", got)
	}
}

// memogit only ever adds attachments. Any call that removes, replaces or edits
// one belongs to the user in the app, so none may appear in this package.
func TestNoAttachmentRemovalCalls(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	forbidden := []string{"SetMemoAttachments(", "DeleteAttachment(", "BatchDeleteAttachments(", "UnlinkAttachment(", "UpdateAttachment("}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, call := range forbidden {
			if strings.Contains(string(data), call) {
				t.Errorf("%s calls %s; memogit must only add attachments", file, call)
			}
		}
	}
}
