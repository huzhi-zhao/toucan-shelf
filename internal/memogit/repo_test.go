package memogit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// isolateGitConfig makes git see no usable identity, reproducing a fresh
// machine where `git config --global user.email` was never run. useConfigOnly
// stands in for the failed auto-detection of a hostname-less box: it forbids
// git from inventing an identity from gecos/hostname.
func isolateGitConfig(t *testing.T) {
	t.Helper()
	globalCfg := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(globalCfg, []byte("[user]\n\tuseConfigOnly = true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", globalCfg)
	t.Setenv("GIT_CONFIG_SYSTEM", os.DevNull)
	for _, k := range []string{
		"GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
		"GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
		"EMAIL",
	} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
}

func TestGitCommitAllWithoutMachineIdentity(t *testing.T) {
	isolateGitConfig(t)
	root := t.TempDir()
	if err := GitInitIfNeeded(root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := GitCommitAll(root, "baseline"); err != nil {
		t.Fatalf("commit without a configured identity should succeed: %v", err)
	}
	out, err := git(root, "log", "-1", "--pretty=%an <%ae>")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, fallbackGitEmail) {
		t.Fatalf("expected fallback identity in log, got %q", out)
	}
}

func TestEnsureGitIdentityUsesAccountAndIsSkippedWhenConfigured(t *testing.T) {
	isolateGitConfig(t)
	root := t.TempDir()
	if err := GitInitIfNeeded(root); err != nil {
		t.Fatal(err)
	}
	if err := EnsureGitIdentity(root, "James", "james@example.com"); err != nil {
		t.Fatal(err)
	}
	if out, _ := git(root, "config", "user.email"); strings.TrimSpace(out) != "james@example.com" {
		t.Fatalf("account email not written: %q", out)
	}

	// A second call must not overwrite an identity that already resolves.
	if err := EnsureGitIdentity(root, "Other", "other@example.com"); err != nil {
		t.Fatal(err)
	}
	if out, _ := git(root, "config", "user.email"); strings.TrimSpace(out) != "james@example.com" {
		t.Fatalf("existing identity was overwritten: %q", out)
	}
	if args := commitIdentityArgs(root); args != nil {
		t.Fatalf("expected no -c overrides once an identity exists, got %v", args)
	}
}
