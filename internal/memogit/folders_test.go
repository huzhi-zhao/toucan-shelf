package memogit

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/proto/gen/api/v1/apiv1connect"
)

func TestNormalizeFolders(t *testing.T) {
	got, err := NormalizeFolders([]string{" /CMOP/ ", "Infra/Deploy", "CMOP/Notes", "CMOP", "Infra-x"})
	if err != nil {
		t.Fatal(err)
	}
	// Trimmed, deduplicated, a folder under another listed folder dropped, sorted.
	want := []string{"CMOP", "Infra-x", "Infra/Deploy"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("NormalizeFolders = %q, want %q", got, want)
	}

	if got, err := NormalizeFolders(nil); err != nil || got != nil {
		t.Errorf("NormalizeFolders(nil) = %q, %v; want nil, nil", got, err)
	}
	for _, bad := range []string{"", "/", "a//b", "../x", "a/./b", ".home", "a/.hidden", "_sub", "_sub/abc"} {
		if _, err := NormalizeFolders([]string{bad}); err == nil {
			t.Errorf("NormalizeFolders(%q) accepted an invalid folder", bad)
		}
	}
}

func TestFoldersScopeAndPaths(t *testing.T) {
	ws := &WorkspaceConfig{Dir: "SideProjects", Folders: []string{"CMOP", "Infra/Deploy"}}

	scopeCases := map[string]bool{
		"CMOP":              true,
		"CMOP/Notes":        true,
		"/CMOP/Notes/":      true,
		"Infra/Deploy":      true,
		"Infra/Deploy/k8s":  true,
		"Infra":             false, // parent of a listed folder is not in scope
		"CMOPX":             false, // prefix but not a folder boundary
		"":                  false,
		"Other":             false,
		"_sub/0123456789ab": false, // sub-documents follow their parent, never the prefix
	}
	for folder, want := range scopeCases {
		if got := ws.inScope(folder); got != want {
			t.Errorf("inScope(%q) = %v, want %v", folder, got, want)
		}
	}

	// Local paths mirror the server folder_path in both directions.
	if got := ws.LocalRelPath("CMOP/Notes", "a", "MARKDOWN"); got != filepath.Join("CMOP", "Notes", "a.md") {
		t.Errorf("LocalRelPath = %q", got)
	}
	if got := ws.ServerFolderPath("Infra/Deploy"); got != "Infra/Deploy" {
		t.Errorf("ServerFolderPath = %q", got)
	}

	outCases := map[string]bool{
		"CMOP/new.md":             false,
		"Infra/Deploy/k8s/new.md": false,
		"Other/new.md":            true,
		"Infra/new.md":            true,
		"root.md":                 true,
	}
	for rel, want := range outCases {
		if _, got := ws.outOfScope(rel); got != want {
			t.Errorf("outOfScope(%q) = %v, want %v", rel, got, want)
		}
	}

	// A full checkout and a legacy stripped sparse checkout are never out of scope.
	full := &WorkspaceConfig{Dir: "KB"}
	stripped := &WorkspaceConfig{Dir: ".", Sparse: "Home"}
	for _, rel := range []string{"root.md", "a/b/c.md"} {
		if _, out := full.outOfScope(rel); out {
			t.Errorf("full checkout: outOfScope(%q) = true", rel)
		}
		if _, out := stripped.outOfScope(rel); out {
			t.Errorf("stripped sparse: outOfScope(%q) = true", rel)
		}
	}
	// The kept-subdir sparse mode had no push-side scope check; it shares the fix.
	subdir := &WorkspaceConfig{Dir: ".", Sparse: "Home", SparseSubdir: true}
	if _, out := subdir.outOfScope("Other/x.md"); !out {
		t.Error("sparse subdir: outOfScope(Other/x.md) = false, want true")
	}
}

func TestLoadRepoConfigFolders(t *testing.T) {
	path := filepath.Join(t.TempDir(), RepoConfigFile)
	body := "knowledge_bases:\n  - name: SideProjects\n    folders:\n      - CMOP\n      - Infra/Deploy\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	rc, warnings, err := LoadRepoConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
	if got := rc.KnowledgeBases[0].Folders; !reflect.DeepEqual(got, []string{"CMOP", "Infra/Deploy"}) {
		t.Errorf("Folders = %q", got)
	}
}

// fakeServer is the slice of the ToucanShelf API that clone, pull and push
// touch: one admin user, one workspace, a flat set of memos (no sub-documents),
// and a log of every write.
type fakeServer struct {
	apiv1connect.UnimplementedMemoServiceHandler
	apiv1connect.UnimplementedAuthServiceHandler
	apiv1connect.UnimplementedWorkspaceServiceHandler

	mu     sync.Mutex
	ws     *v1pb.Workspace
	memos  []*v1pb.Memo
	writes []string
}

func newFakeServer(t *testing.T, memos ...*v1pb.Memo) (*fakeServer, string) {
	t.Helper()
	f := &fakeServer{ws: &v1pb.Workspace{Name: "workspaces/w1", Title: "SideProjects"}, memos: memos}
	mux := http.NewServeMux()
	mux.Handle(apiv1connect.NewMemoServiceHandler(f))
	mux.Handle(apiv1connect.NewAuthServiceHandler(f))
	mux.Handle(apiv1connect.NewWorkspaceServiceHandler(f))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return f, srv.URL
}

func fakeMemo(uid, folder, title, content string) *v1pb.Memo {
	return &v1pb.Memo{
		Name: "memos/" + uid, Workspace: "workspaces/w1", FolderPath: folder, Title: title,
		Content: content, DocType: v1pb.Memo_MARKDOWN, State: v1pb.State_NORMAL, Visibility: v1pb.Visibility_PRIVATE,
	}
}

func (f *fakeServer) GetCurrentUser(context.Context, *connect.Request[v1pb.GetCurrentUserRequest]) (*connect.Response[v1pb.GetCurrentUserResponse], error) {
	user := &v1pb.User{Name: "users/1", Username: "admin", Role: v1pb.User_ADMIN, Email: "admin@example.com"}
	return connect.NewResponse(&v1pb.GetCurrentUserResponse{User: user}), nil
}

func (f *fakeServer) ListWorkspaces(context.Context, *connect.Request[v1pb.ListWorkspacesRequest]) (*connect.Response[v1pb.ListWorkspacesResponse], error) {
	return connect.NewResponse(&v1pb.ListWorkspacesResponse{Workspaces: []*v1pb.Workspace{f.ws}}), nil
}

// ListMemos ignores the CEL filter: the admin scope has no authorship clause,
// and pull's updated_ts clause only narrows what its hash check dedupes anyway.
func (f *fakeServer) ListMemos(context.Context, *connect.Request[v1pb.ListMemosRequest]) (*connect.Response[v1pb.ListMemosResponse], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return connect.NewResponse(&v1pb.ListMemosResponse{Memos: append([]*v1pb.Memo(nil), f.memos...)}), nil
}

func (f *fakeServer) ListMemoComments(context.Context, *connect.Request[v1pb.ListMemoCommentsRequest]) (*connect.Response[v1pb.ListMemoCommentsResponse], error) {
	return connect.NewResponse(&v1pb.ListMemoCommentsResponse{}), nil
}

func (f *fakeServer) CreateMemo(_ context.Context, req *connect.Request[v1pb.CreateMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m := req.Msg.GetMemo()
	created := fakeMemo("new"+string(rune('a'+len(f.memos))), m.GetFolderPath(), m.GetTitle(), m.GetContent())
	f.memos = append(f.memos, created)
	f.writes = append(f.writes, "create "+m.GetFolderPath()+"/"+m.GetTitle())
	return connect.NewResponse(created), nil
}

func (f *fakeServer) UpdateMemo(_ context.Context, req *connect.Request[v1pb.UpdateMemoRequest]) (*connect.Response[v1pb.Memo], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes = append(f.writes, "update "+req.Msg.GetMemo().GetName()+" "+strings.Join(req.Msg.GetUpdateMask().GetPaths(), ","))
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// withFakeServer points memogit's environment credentials at the fake server
// and gives git an identity, so clone and pull can commit.
func withFakeServer(t *testing.T, url string) {
	t.Setenv(EnvToucanServer, url)
	t.Setenv(EnvToucanToken, "memos_pat_test")
	t.Setenv("GIT_AUTHOR_NAME", "t")
	t.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "t")
	t.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")
}

func writeRepoConf(t *testing.T, base string, folders ...string) *RepoConfig {
	t.Helper()
	body := "knowledge_bases:\n  - name: sideprojects\n    attachments: false\n"
	if len(folders) > 0 {
		body += "    folders: [" + strings.Join(folders, ", ") + "]\n"
	}
	path := filepath.Join(base, RepoConfigFile)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	rc, _, err := LoadRepoConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	return rc
}

// docFiles lists the documents checked out under the knowledge base's folder.
func docFiles(t *testing.T, contentRoot string) []string {
	t.Helper()
	files, err := listDocFiles(contentRoot, nil)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, f := range files {
		out = append(out, filepath.ToSlash(f))
	}
	sort.Strings(out)
	return out
}

// The folder scope in memogit.conf.yaml is the source of truth on every sync:
// the first sync checks out only the listed folders, under the knowledge
// base's own subfolder; changing the list narrows or widens the checkout
// without a re-clone, and dropping it brings in the whole knowledge base.
func TestSyncRepoFoldersScope(t *testing.T) {
	_, url := newFakeServer(t,
		fakeMemo("a1", "CMOP", "Plan", "plan"),
		fakeMemo("a2", "CMOP/Notes", "Day1", "day one"),
		fakeMemo("b1", "Infra/Deploy", "Runbook", "runbook"),
		fakeMemo("c1", "Other", "Misc", "misc"),
		fakeMemo("r1", "", "Readme", "readme"),
	)
	withFakeServer(t, url)
	base := t.TempDir()
	ctx := context.Background()

	sync := func(folders ...string) []string {
		t.Helper()
		rc := writeRepoConf(t, base, folders...)
		var detail bytes.Buffer
		results, err := SyncRepo(ctx, rc, &detail)
		if err != nil {
			t.Fatalf("SyncRepo: %v\n%s", err, detail.String())
		}
		if len(results) != 1 || results[0].Err != nil {
			t.Fatalf("SyncRepo results: %+v\n%s", results, detail.String())
		}
		if results[0].Dir != "SideProjects" {
			t.Fatalf("Dir = %q, want the knowledge base's own subfolder", results[0].Dir)
		}
		return docFiles(t, filepath.Join(rc.Root(), "SideProjects"))
	}

	if got, want := sync("CMOP", "Infra/Deploy"), []string{"CMOP/Notes/Day1.md", "CMOP/Plan.md", "Infra/Deploy/Runbook.md"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("first sync: %q, want %q", got, want)
	}
	if got, want := sync("Other"), []string{"Other/Misc.md"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("after switching folders: %q, want %q", got, want)
	}
	want := []string{"CMOP/Notes/Day1.md", "CMOP/Plan.md", "Infra/Deploy/Runbook.md", "Other/Misc.md", "Readme.md"}
	if got := sync(); !reflect.DeepEqual(got, want) {
		t.Fatalf("after dropping folders: %q, want %q", got, want)
	}

	cfg, err := LoadConfig(filepath.Join(base, DefaultRepoCheckoutDir))
	if err != nil {
		t.Fatal(err)
	}
	if ws := cfg.Workspaces[0]; len(ws.Folders) != 0 || ws.Sparse != "" || ws.Dir != "SideProjects" {
		t.Errorf("workspace config after dropping folders: %+v", ws)
	}
}

// Push never creates or moves a document outside the checkout's folders: the
// next pull would drop it from the checkout, so the file would seem to vanish.
func TestPushRefusesFilesOutsideFolders(t *testing.T) {
	f, url := newFakeServer(t,
		fakeMemo("a1", "CMOP", "Plan", "plan"),
		fakeMemo("a2", "CMOP", "Moving", "moving"),
		fakeMemo("c1", "Other", "Misc", "misc"),
	)
	withFakeServer(t, url)
	base := t.TempDir()
	ctx := context.Background()
	rc := writeRepoConf(t, base, "CMOP")
	if _, err := SyncRepo(ctx, rc, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	root := rc.Root()
	content := filepath.Join(root, "SideProjects")

	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(content, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("CMOP/Fresh.md", "inside")
	write("Elsewhere/Stray.md", "outside")
	write("Top.md", "outside too")
	if err := os.MkdirAll(filepath.Join(content, "Other"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(content, "CMOP", "Moving.md"), filepath.Join(content, "Other", "Moving.md")); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	res, err := Push(ctx, root, cfg, cfg.Workspaces[0], true, &out)
	if err != nil {
		t.Fatalf("Push: %v\n%s", err, out.String())
	}
	skipped := append([]string(nil), res.Skipped...)
	sort.Strings(skipped)
	if want := []string{filepath.Join("Elsewhere", "Stray.md"), filepath.Join("Other", "Moving.md"), "Top.md"}; !reflect.DeepEqual(skipped, want) {
		t.Errorf("Skipped = %q, want %q\n%s", skipped, want, out.String())
	}
	// The moved file still claims its document, so it is not archived either.
	if res.Created != 1 || res.Moved != 0 || res.Archived != 0 {
		t.Errorf("created=%d moved=%d archived=%d, want 1/0/0\n%s", res.Created, res.Moved, res.Archived, out.String())
	}
	if !strings.Contains(out.String(), `outside this checkout's folders "CMOP"`) {
		t.Errorf("skip message does not name the checkout's folders:\n%s", out.String())
	}
	if len(f.writes) != 0 {
		t.Errorf("dry run wrote to the server: %v", f.writes)
	}
}

// Folder names are matched case-sensitively and never checked against the
// server's tree, so one that matches nothing is called out at clone time.
func TestCloneWarnsAboutFoldersMatchingNothing(t *testing.T) {
	_, url := newFakeServer(t, fakeMemo("a1", "CMOP", "Plan", "plan"))
	withFakeServer(t, url)
	rc := writeRepoConf(t, t.TempDir(), "CMOP", "cmop-typo")
	var detail bytes.Buffer
	results, err := SyncRepo(context.Background(), rc, &detail)
	if err != nil || results[0].Err != nil {
		t.Fatalf("SyncRepo: %v %+v\n%s", err, results, detail.String())
	}
	if !strings.Contains(detail.String(), `folder "cmop-typo" matched no document`) {
		t.Errorf("no warning for the folder matching nothing:\n%s", detail.String())
	}
	if strings.Contains(detail.String(), `folder "CMOP" matched no document`) {
		t.Errorf("warned about a folder that does match:\n%s", detail.String())
	}
}

// A sparse entry in memogit.conf.yaml is still refused (it would map a folder
// onto the shared checkout root), and the error points at folders instead.
func TestSyncRepoRejectsSparsePointingAtFolders(t *testing.T) {
	_, url := newFakeServer(t)
	withFakeServer(t, url)
	base := t.TempDir()
	path := filepath.Join(base, RepoConfigFile)
	if err := os.WriteFile(path, []byte("knowledge_bases:\n  - name: SideProjects\n    sparse: CMOP\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rc, _, err := LoadRepoConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	results, err := SyncRepo(context.Background(), rc, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Err == nil || !strings.Contains(results[0].Err.Error(), "folders") {
		t.Errorf("Err = %v, want a refusal pointing at folders", results[0].Err)
	}
}
