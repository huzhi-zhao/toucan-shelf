package memogit

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// A single attachment the server refuses to serve (the real-world case: a 500
// on one image) must not abort the export: the rest is downloaded, the failure
// is named in the output, and no ref is recorded so the next pull retries it.
func TestDownloadMemoAttachmentsSkipsServerErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "broken") {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte("ok-bytes"))
	}))
	defer srv.Close()

	client := NewClient(&Config{Server: srv.URL, Token: "t"})
	m := &v1pb.Memo{
		Name: "memos/m1",
		Attachments: []*v1pb.Attachment{
			{Name: "attachments/broken", Filename: "image.png", Size: 10},
			{Name: "attachments/good", Filename: "note.txt", Size: 8},
		},
	}

	root := t.TempDir()
	var out bytes.Buffer
	warn := &attachmentWarner{out: &out}
	refs, n, err := downloadMemoAttachments(context.Background(), client, root, "docs/Doc.md", m, nil, warn)
	if err != nil {
		t.Fatalf("expected the failure to be skipped, got error: %v", err)
	}
	if n != 1 || len(refs) != 1 || refs[0].Name != "attachments/good" {
		t.Fatalf("expected only the good attachment recorded, got n=%d refs=%+v", n, refs)
	}
	if warn.failed != 1 {
		t.Fatalf("expected 1 counted failure, got %d", warn.failed)
	}
	msg := out.String()
	for _, want := range []string{"image.png", "attachments/broken", "docs/Doc.md", "500"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("warning %q missing %q", msg, want)
		}
	}
	if _, err := os.Stat(filepath.Join(root, refs[0].Path)); err != nil {
		t.Fatalf("good attachment not written: %v", err)
	}
}

// The file route answers several distinct failures with a bare 500, so the
// body's message is the only thing that says which one happened.
func TestErrorBodySuffix(t *testing.T) {
	cases := map[string]string{
		`{"message":"failed to get attachment reader"}`: " (failed to get attachment reader)",
		"plain text\n":                                  " (plain text)",
		"":                                              "",
	}
	for body, want := range cases {
		if got := errorBodySuffix(strings.NewReader(body)); got != want {
			t.Errorf("errorBodySuffix(%q) = %q, want %q", body, got, want)
		}
	}
}
