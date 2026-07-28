package memogit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The whole scheme rests on one invariant: whatever InjectLocalID adds,
// StripLocalID takes back off exactly. If that ever stops holding, every synced
// file starts looking locally modified and push manufactures conflicts.
func TestLocalIDRoundTrip(t *testing.T) {
	bodies := map[string]string{
		"plain":               "# Title\n\nsome body",
		"obsidian":            "---\nstatus: done\ntags: [a, b]\n---\n# Hello\n\nbody",
		"trailing newlines":   "body",
		"html comment inside": "text\n\n<!-- a normal comment -->\n\nmore",
		"empty":               "",
	}
	for name, body := range bodies {
		for _, docType := range []string{"MARKDOWN", "HTML", "PDF"} {
			got := StripLocalID(InjectLocalID(body, "uid123", docType))
			if got != strings.TrimRight(body, "\n") {
				t.Errorf("%s/%s: round trip = %q, want %q", name, docType, got, body)
			}
			if uid := ParseLocalID(InjectLocalID(body, "uid123", docType)); uid != "uid123" {
				t.Errorf("%s/%s: parsed uid = %q", name, docType, uid)
			}
		}
	}
}

// A document's own Obsidian frontmatter must stay the first thing in the file —
// a marker above it would stop the properties block from parsing at all.
func TestLocalIDNeverPrecedesFrontmatter(t *testing.T) {
	body := "---\nstatus: done\n---\n# Hello"
	got := InjectLocalID(body, "uid123", "MARKDOWN")
	if !strings.HasPrefix(got, "---\nstatus: done\n---") {
		t.Errorf("marker displaced the user's frontmatter:\n%s", got)
	}
}

// VIEW documents are consumed as JSON by agents and linters, so their marker
// goes inside the object rather than after it.
func TestLocalIDViewStaysValidJSON(t *testing.T) {
	cases := []string{
		`{"viewType":"gallery","blocks":[]}`,
		"{\n  \"viewType\": \"gallery\",\n  \"blocks\": []\n}",
		"---\ntitle: Dash\n---\n{\n  \"viewType\": \"gallery\"\n}",
	}
	for _, body := range cases {
		marked := InjectLocalID(body, "uid123", "VIEW")
		if ParseLocalID(marked) != "uid123" {
			t.Errorf("marker not parsed back from %q", marked)
		}
		if got := StripLocalID(marked); got != strings.TrimRight(body, "\n") {
			t.Errorf("view round trip = %q, want %q", got, body)
		}
		// The JSON half must still parse, with the marker as an ordinary key.
		jsonPart := marked[strings.Index(marked, "{"):]
		var obj map[string]any
		if err := json.Unmarshal([]byte(jsonPart), &obj); err != nil {
			t.Errorf("marked view is not valid JSON: %v\n%s", err, marked)
			continue
		}
		if obj[localIDKey] != "memos/uid123" {
			t.Errorf("marker key missing from parsed JSON: %v", obj)
		}
	}
}

// A malformed view has no object to put a key in; rewriting it would only make
// things worse, so it is left alone and falls back to path tracking.
func TestLocalIDViewWithoutObjectLeftAlone(t *testing.T) {
	body := "not json at all"
	if got := InjectLocalID(body, "uid123", "VIEW"); got != body {
		t.Errorf("malformed view was rewritten: %q", got)
	}
}

// Re-exporting a file must not stack markers.
func TestLocalIDInjectIsIdempotent(t *testing.T) {
	once := InjectLocalID("body", "uid1", "MARKDOWN")
	twice := InjectLocalID(once, "uid1", "MARKDOWN")
	if once != twice {
		t.Errorf("not idempotent:\n once=%q\ntwice=%q", once, twice)
	}
	// Re-stamping with a different uid replaces rather than appends.
	changed := InjectLocalID(once, "uid2", "MARKDOWN")
	if ParseLocalID(changed) != "uid2" || strings.Count(changed, localIDKey) != 1 {
		t.Errorf("re-stamp left a stale marker: %q", changed)
	}
}

func TestParseLocalIDAbsent(t *testing.T) {
	if uid := ParseLocalID("# just a document\n"); uid != "" {
		t.Errorf("ParseLocalID on unmarked content = %q, want empty", uid)
	}
}

// ensureLocalIDs is what upgrades a checkout made before markers existed. It
// must stamp the files without making them look edited.
func TestEnsureLocalIDsStampsWithoutChangingContent(t *testing.T) {
	root := t.TempDir()
	body := "# Old note\n\nwritten before markers"
	if err := writeFile(root, filepath.Join("notes", "old.md"), body); err != nil {
		t.Fatal(err)
	}
	state := &State{Memos: map[string]MemoState{
		"uid1": {Path: filepath.Join("notes", "old.md"), DocType: "MARKDOWN", ContentHash: CanonicalHash(body)},
	}}

	n, err := ensureLocalIDs(root, state)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("stamped %d files, want 1", n)
	}
	data, err := os.ReadFile(filepath.Join(root, "notes", "old.md"))
	if err != nil {
		t.Fatal(err)
	}
	if ParseLocalID(string(data)) != "uid1" {
		t.Errorf("file not stamped:\n%s", data)
	}
	// Crucially: stamping is invisible to change detection.
	if localHash(data) != state.Memos["uid1"].ContentHash {
		t.Error("stamping made the file look locally modified")
	}
	// Second run is a no-op.
	if n, err := ensureLocalIDs(root, state); err != nil || n != 0 {
		t.Errorf("second run stamped %d files (err=%v), want 0", n, err)
	}
}

func TestFileContentCarriesMemoUID(t *testing.T) {
	m := mkMemo("xyz789", "f", "T", "hello", v1pb.Memo_MARKDOWN)
	if got := ParseLocalID(FileContent(m, nil)); got != "xyz789" {
		t.Errorf("FileContent marker uid = %q", got)
	}
	// PDF stubs carry one too, so moving a stub moves the PDF document.
	pdf := mkMemo("pdf42", "papers", "P", "", v1pb.Memo_PDF)
	if got := ParseLocalID(FileContent(pdf, nil)); got != "pdf42" {
		t.Errorf("PDF stub marker uid = %q", got)
	}
}
