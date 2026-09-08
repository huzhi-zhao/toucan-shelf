package memogit

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// memoWithAttachments builds a memo carrying attachment metadata plus the refs
// a successful download would have recorded, which is the pair FileContent
// works from.
func memoWithAttachments(content string, atts ...*v1pb.Attachment) (*v1pb.Memo, []AttachmentRef) {
	m := mkMemo("uid1", "notes", "Doc", content, v1pb.Memo_MARKDOWN)
	m.Attachments = atts
	refs := make([]AttachmentRef, 0, len(atts))
	for _, a := range atts {
		refs = append(refs, AttachmentRef{
			Name:     a.GetName(),
			Filename: a.GetFilename(),
			Size:     a.GetSize(),
			Path:     attachmentRelPath(a.GetName(), a.GetFilename()),
		})
	}
	return m, refs
}

func att(uid, filename, mimeType string, size int64) *v1pb.Attachment {
	return &v1pb.Attachment{Name: "attachments/" + uid, Filename: filename, Type: mimeType, Size: size}
}

// The manifest exists only to be read locally. If it ever survived into what
// push uploads, every document with an attachment would grow a block of
// memogit's own bookkeeping on the server — and every sync afterwards would see
// a local edit that isn't one.
func TestManifestRoundTripsToNothing(t *testing.T) {
	bodies := map[string]string{
		"plain":               "# Title\n\nbody",
		"obsidian":            "---\nstatus: done\n---\n# Hello\n\nbody",
		"html comment inside": "text\n\n<!-- a normal comment -->\n\nmore",
		"inline reference":    "see ![chart](/file/attachments/a1/chart.png)",
		"empty":               "",
	}
	for name, body := range bodies {
		m, refs := memoWithAttachments(body,
			att("a1", "chart.png", "image/png", 245760),
			att("a2", "report.pdf", "application/pdf", 13002342),
		)
		got := StripLocalID(FileContent(m, refs))
		if want := strings.TrimRight(body, "\n"); got != want {
			t.Errorf("%s: round trip = %q, want %q", name, got, want)
		}
	}
}

// A pull that changes nothing must write the same bytes, or every sync shows up
// as a diff in the user's git history.
func TestManifestIsStable(t *testing.T) {
	m, refs := memoWithAttachments("body", att("a1", "chart.png", "image/png", 1024))
	first := FileContent(m, refs)
	if second := FileContent(m, refs); first != second {
		t.Errorf("FileContent not stable:\nfirst:  %q\nsecond: %q", first, second)
	}
	// Re-stamping the identity of the file we just wrote must not perturb it
	// either: ensureLocalIDs takes that path on every sync.
	if again := InjectLocalID(first, "uid1", "MARKDOWN"); again != first {
		t.Errorf("re-stamping changed the file:\n got %q\nwant %q", again, first)
	}
}

// An attachment referenced from the body already has context around it; one
// that is merely mounted has nothing but its filename. A reader deciding
// whether to open a file needs the two told apart.
func TestManifestSplitsInlineFromMounted(t *testing.T) {
	body := "intro\n\n![chart](/file/attachments/a1/chart.png)\n"
	m, refs := memoWithAttachments(body,
		att("a1", "chart.png", "image/png", 245760),
		att("a2", "report.pdf", "application/pdf", 13002342),
	)

	block := renderManifest(m, refs)
	inline, mounted, ok := strings.Cut(block, "mounted:\n")
	if !ok {
		t.Fatalf("no mounted section:\n%s", block)
	}
	if !strings.Contains(inline, "inline:\n- chart.png (image/png, 240 KB) -> _attachments/a1/chart.png\n") {
		t.Errorf("inline section wrong:\n%s", inline)
	}
	if !strings.Contains(mounted, "- report.pdf (application/pdf, 12.4 MB) -> _attachments/a2/report.pdf\n") {
		t.Errorf("mounted section wrong:\n%s", mounted)
	}
	if strings.Contains(inline, "report.pdf") {
		t.Errorf("mounted attachment leaked into the inline section:\n%s", block)
	}
}

// The inline test is a substring match on the file route, so it has to hold for
// a fully-qualified URL as well as a site-relative one, and it must not fire on
// a different attachment whose uid merely shares a prefix.
func TestManifestInlineDetection(t *testing.T) {
	cases := map[string]struct {
		body string
		want bool
	}{
		"site relative":    {"![](/file/attachments/a1/chart.png)", true},
		"absolute url":     {"![](https://kb.example.com/file/attachments/a1/chart.png)", true},
		"percent encoded":  {"![](/file/attachments/a1/%E5%9B%BE.png)", true},
		"not referenced":   {"no attachments here", false},
		"uid prefix only":  {"![](/file/attachments/a123/other.png)", false},
		"name without uid": {"attachments/a1 mentioned in prose", false},
	}
	for name, tc := range cases {
		if got := referencesAttachment(tc.body, "attachments/a1"); got != tc.want {
			t.Errorf("%s: referencesAttachment = %v, want %v", name, got, tc.want)
		}
	}
}

// A filename is server-supplied text. One carrying a newline or a comment
// terminator would produce a block the strip regex cannot match, and an
// unstrippable marker means a phantom conflict on every later sync.
func TestManifestSurvivesHostileFilenames(t *testing.T) {
	body := "body"
	for name, filename := range map[string]string{
		"comment terminator": "evil --> oops.txt",
		"newline":            "two\nlines.txt",
		"carriage return":    "cr\r.txt",
	} {
		m, refs := memoWithAttachments(body, att("a1", filename, "text/plain", 12))
		file := FileContent(m, refs)
		if got := StripLocalID(file); got != body {
			t.Errorf("%s: strip left %q, want %q\nfile was:\n%s", name, got, body, file)
		}
		if uid := ParseLocalID(file); uid != "uid1" {
			t.Errorf("%s: identity marker unreadable, got %q", name, uid)
		}
	}
}

// No attachments means no block at all: the overwhelming majority of documents
// must keep exactly the bytes they had before the manifest existed.
func TestManifestAbsentWithoutAttachments(t *testing.T) {
	m := mkMemo("uid1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	if got, want := FileContent(m, nil), InjectLocalID("body", "uid1", "MARKDOWN"); got != want {
		t.Errorf("file content = %q, want %q", got, want)
	}
}

// An attachment whose download failed has no local bytes to point at, so it has
// no place in a manifest whose whole job is to name local paths.
func TestManifestOmitsUndownloadedAttachments(t *testing.T) {
	m := mkMemo("uid1", "notes", "Doc", "body", v1pb.Memo_MARKDOWN)
	m.Attachments = []*v1pb.Attachment{
		att("good", "ok.txt", "text/plain", 8),
		att("broken", "missing.png", "image/png", 99),
	}
	refs := []AttachmentRef{{Name: "attachments/good", Filename: "ok.txt", Size: 8, Path: "_attachments/good/ok.txt"}}

	block := renderManifest(m, refs)
	if !strings.Contains(block, "ok.txt") {
		t.Errorf("downloaded attachment missing:\n%s", block)
	}
	if strings.Contains(block, "missing.png") {
		t.Errorf("undownloaded attachment listed:\n%s", block)
	}
}

// VIEW documents are consumed as JSON. An HTML comment would make the file
// unparseable, so they carry the identity marker only.
func TestManifestSkippedForViewDocuments(t *testing.T) {
	m, refs := memoWithAttachments(`{"viewType":"gallery"}`, att("a1", "cover.png", "image/png", 1024))
	m.DocType = v1pb.Memo_VIEW

	file := FileContent(m, refs)
	if strings.Contains(file, manifestKey) {
		t.Errorf("view document carries a manifest:\n%s", file)
	}
	if got := StripLocalID(file); got != `{"viewType":"gallery"}` {
		t.Errorf("stripped view = %q", got)
	}
}

// A manifest is rebuilt from server data, which ensureLocalIDs does not have.
// Re-stamping a file read off disk must therefore carry the block over rather
// than drop it — otherwise the pointer disappears until the document's content
// happens to change on the server.
func TestInjectLocalIDPreservesManifest(t *testing.T) {
	m, refs := memoWithAttachments("body", att("a1", "chart.png", "image/png", 1024))
	file := FileContent(m, refs)

	// The file on disk lost its marker (deleted by a hand or an agent); this is
	// exactly what ensureLocalIDs finds and repairs.
	damaged := commentRe.ReplaceAllString(file, "")
	repaired := InjectLocalID(damaged, "uid1", "MARKDOWN")

	if !strings.Contains(repaired, "_attachments/a1/chart.png") {
		t.Errorf("re-stamping dropped the manifest:\n%s", repaired)
	}
	if got := ParseLocalID(repaired); got != "uid1" {
		t.Errorf("identity not restored, got %q", got)
	}
	if repaired != file {
		t.Errorf("repair diverged from the original:\n got %q\nwant %q", repaired, file)
	}
}

// A malformed block — no closing line — must match nothing rather than swallow
// the rest of the document.
func TestManifestStripLeavesMalformedBlockAlone(t *testing.T) {
	content := "body\n\n<!-- memogit-attachments: truncated\ninline:\n- a.txt (text/plain, 8 B) -> _attachments/a/a.txt\n"
	if got := stripManifest(content); got != content {
		t.Errorf("malformed block was consumed:\n got %q\nwant %q", got, content)
	}
}

// The end-to-end version of the round-trip invariant, and the one that actually
// bites: a file written with a manifest must hash equal to its own baseline. If
// it does not, every document with an attachment reads as locally modified, and
// the next sync manufactures a conflict for it.
func TestManifestDoesNotLookLikeALocalEdit(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	m, refs := memoWithAttachments("see ![chart](/file/attachments/a1/chart.png)\n\nrest",
		att("a1", "chart.png", "image/png", 245760),
		att("a2", "report.pdf", "application/pdf", 13002342),
	)

	ms, err := writeMemoDoc(ws, root, m, refs)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), manifestKey) {
		t.Fatalf("no manifest written:\n%s", data)
	}
	if localHash(data) != ms.ContentHash {
		t.Errorf("manifest reads as a local edit: file hash %q != baseline %q",
			localHash(data), ms.ContentHash)
	}

	// And what push would upload is the server's content, manifest excluded.
	if got := StripLocalID(string(data)); got != m.GetContent() {
		t.Errorf("push would upload %q, want %q", got, m.GetContent())
	}
}

// A pull that finds nothing changed must leave the file alone. Re-exporting is
// the path that would rewrite it, so the manifest has to survive that untouched
// — otherwise every pull dirties the user's git work tree.
func TestManifestSurvivesUnchangedReconcile(t *testing.T) {
	root := t.TempDir()
	ws := &WorkspaceConfig{}
	m, refs := memoWithAttachments("body", att("a1", "chart.png", "image/png", 1024))

	ms, err := writeMemoDoc(ws, root, m, refs)
	if err != nil {
		t.Fatal(err)
	}
	state := NewState("https://example.test")
	state.Memos["uid1"] = ms
	before, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatal(err)
	}

	// A nil client is safe: the refs already on disk match the server's sizes,
	// so no download is attempted.
	res := &PullResult{}
	if err := reconcileAgainst(context.Background(), nil, ws, root,
		[]*v1pb.Memo{m}, state, res, io.Discard, nil); err != nil {
		t.Fatal(err)
	}
	if res.Updated != 0 || len(res.Conflicts) != 0 {
		t.Errorf("unchanged memo disturbed: updated=%d conflicts=%v", res.Updated, res.Conflicts)
	}

	after, err := os.ReadFile(filepath.Join(root, ms.Path))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Errorf("reconcile rewrote the file:\n got %q\nwant %q", after, before)
	}
}

func TestHumanSize(t *testing.T) {
	cases := map[int64]string{
		0:        "0 B",
		512:      "512 B",
		1024:     "1.0 KB",
		8192:     "8.0 KB",
		245760:   "240 KB",
		1048576:  "1.0 MB",
		13002342: "12.4 MB",
		// Three digits stay whole: "999 KB" reads better than "999.4 KB" and the
		// extra precision decides nothing.
		1023000: "999 KB",
	}
	for size, want := range cases {
		if got := humanSize(size); got != want {
			t.Errorf("humanSize(%d) = %q, want %q", size, got, want)
		}
	}
}
