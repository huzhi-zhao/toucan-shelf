package memogit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// distServer publishes one linux-amd64 binary with the given body and the
// checksum it advertises in version.json.
func distServer(t *testing.T, body, advertisedSum string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case DistPath + "/version.json":
			_ = json.NewEncoder(w).Encode(Distribution{
				Version: "2026.10.06-abcdef123",
				Files:   map[string]DistFile{"linux-amd64": {Name: "memogit-linux-amd64", SHA256: advertisedSum}},
			})
		case DistPath + "/memogit-linux-amd64":
			_, _ = io.WriteString(w, body)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func TestFetchDistribution(t *testing.T) {
	srv := distServer(t, "new", sum("new"))
	d, err := FetchDistribution(context.Background(), srv.URL+"/", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if d.Version != "2026.10.06-abcdef123" || d.Files["linux-amd64"].Name != "memogit-linux-amd64" {
		t.Fatalf("unexpected distribution: %+v", d)
	}

	// A server without a distribution is an error, which callers treat as "can't tell".
	empty := httptest.NewServer(http.NotFoundHandler())
	defer empty.Close()
	if _, err := FetchDistribution(context.Background(), empty.URL, time.Second); err == nil {
		t.Fatal("expected an error for a server without /memogit/version.json")
	}
}

func TestUpdateBinary(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "memogit")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	srv := distServer(t, "new", sum("new"))
	var out strings.Builder
	if _, err := updateBinary(context.Background(), srv.URL, "linux-amd64", exe, &out); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "new" {
		t.Fatalf("binary not replaced: %q", got)
	}
	if info, _ := os.Stat(exe); info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("replaced binary is not executable: %v", info.Mode())
	}

	if _, err := updateBinary(context.Background(), srv.URL, "plan9-arm", exe, io.Discard); err == nil {
		t.Fatal("expected an error for a platform the server does not publish")
	}
}

func TestUpdateBinaryRejectsBadChecksum(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "memogit")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	srv := distServer(t, "tampered", sum("new"))
	if _, err := updateBinary(context.Background(), srv.URL, "linux-amd64", exe, io.Discard); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("expected a checksum error, got %v", err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "old" {
		t.Fatalf("binary changed despite bad checksum: %q", got)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("temp file left behind: %v", entries)
	}
}
