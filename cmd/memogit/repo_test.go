package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func clearCredentialEnv(t *testing.T) {
	for _, k := range []string{"TOUCANSHELF_SERVER", "TOUCANSHELF_PAT", "MEMOGIT_SERVER", "MEMOGIT_TOKEN"} {
		t.Setenv(k, "")
	}
}

func TestHookSessionStartWithoutRepoConfig(t *testing.T) {
	clearCredentialEnv(t)
	t.Setenv("CLAUDE_PROJECT_DIR", t.TempDir())
	var out strings.Builder
	hookSessionStart(&cobra.Command{}, &out)
	got := out.String()
	if !strings.HasPrefix(got, "⛔ memogit: 知识库未就绪") || !strings.Contains(got, "memogit.conf.yaml") {
		t.Fatalf("unexpected output:\n%s", got)
	}
}

func TestHookSessionStartWithoutCredentials(t *testing.T) {
	clearCredentialEnv(t)
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "memogit.conf.yaml"), []byte("knowledge_bases:\n  - name: Career\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_PROJECT_DIR", repo)
	var out strings.Builder
	hookSessionStart(&cobra.Command{}, &out)
	got := out.String()
	for _, want := range []string{"⛔ memogit: 知识库未就绪", "TOUCANSHELF_SERVER", "TOUCANSHELF_PAT", "不要改用 MCP"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output lacks %q:\n%s", want, got)
		}
	}
}

func TestHookStopWithoutRepoConfigIsSilent(t *testing.T) {
	clearCredentialEnv(t)
	t.Setenv("CLAUDE_PROJECT_DIR", t.TempDir())
	var stderr strings.Builder
	if code := hookStop(&cobra.Command{}, strings.NewReader(`{"stop_hook_active":false}`), &stderr); code != 0 || stderr.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", code, stderr.String())
	}
}

func TestBlockOnce(t *testing.T) {
	if blockOnce(false) != 2 || blockOnce(true) != 0 {
		t.Fatal("stop hook must block once, then only report")
	}
}
