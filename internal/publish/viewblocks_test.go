package publish

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeViewBlocksDropsKnowledgeBaseBlocks(t *testing.T) {
	content := `{"viewType":"home","blocks":[
		{"type":"gallery","title":"Drafts","scope":{"path":"新功能","properties":[{"key":"type","value":"intro"}]}},
		{"type":"calendar","folderPath":"Bugfix"},
		{"type":"public_feed","title":"Latest","tags":["intro"]}
	]}`
	sanitized, dropped, ok := SanitizeViewBlocks(content)
	if !ok {
		t.Fatal("expected the document to parse")
	}
	if dropped != 2 {
		t.Fatalf("dropped = %d, want 2", dropped)
	}
	// The point of the whole exercise: nothing about the library's shape is in
	// the bytes an anonymous reader receives.
	for _, leaked := range []string{"新功能", "Bugfix", "properties", "scope"} {
		if strings.Contains(sanitized, leaked) {
			t.Errorf("sanitized output still carries %q: %s", leaked, sanitized)
		}
	}
}

func TestSanitizeViewBlocksWhitelistsFields(t *testing.T) {
	content := `{"viewType":"home","secretNote":"internal","blocks":[
		{"type":"public_gallery","tags":["a"],"sort":"updated_desc","columns":3,"sourcePath":"内部/草稿"}
	]}`
	sanitized, dropped, ok := SanitizeViewBlocks(content)
	if !ok || dropped != 0 {
		t.Fatalf("ok = %v, dropped = %d", ok, dropped)
	}
	if strings.Contains(sanitized, "sourcePath") || strings.Contains(sanitized, "secretNote") {
		t.Errorf("unknown fields survived: %s", sanitized)
	}
	var doc struct {
		Blocks []map[string]any `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(sanitized), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(doc.Blocks) != 1 || doc.Blocks[0]["sort"] != "updated_desc" {
		t.Fatalf("unexpected blocks: %v", doc.Blocks)
	}
}

func TestSanitizeViewBlocksDropsDocumentBackedMarkdown(t *testing.T) {
	content := `{"viewType":"home","blocks":[
		{"type":"markdown","docName":"memos/abc"},
		{"type":"markdown","content":"# Hello"}
	]}`
	sanitized, dropped, ok := SanitizeViewBlocks(content)
	if !ok || dropped != 1 {
		t.Fatalf("ok = %v, dropped = %d", ok, dropped)
	}
	if got := MarkdownBlockContents(sanitized); len(got) != 1 || got[0] != "# Hello" {
		t.Fatalf("markdown contents = %v", got)
	}
}

func TestSanitizeViewBlocksRejectsUnparseableContent(t *testing.T) {
	if _, _, ok := SanitizeViewBlocks("not json at all"); ok {
		t.Fatal("expected plain text to be rejected")
	}
}

func TestReplaceMarkdownBlockContentsRoundTrip(t *testing.T) {
	sanitized, _, ok := SanitizeViewBlocks(`{"viewType":"home","blocks":[
		{"type":"markdown","content":"a"},
		{"type":"public_feed","title":"Latest"},
		{"type":"markdown","content":"b"}
	]}`)
	if !ok {
		t.Fatal("expected the document to parse")
	}
	out, replaced := ReplaceMarkdownBlockContents(sanitized, []string{"A", "B"})
	if !replaced {
		t.Fatal("expected the prose to be written back")
	}
	if got := MarkdownBlockContents(out); len(got) != 2 || got[0] != "A" || got[1] != "B" {
		t.Fatalf("markdown contents = %v", got)
	}
}
