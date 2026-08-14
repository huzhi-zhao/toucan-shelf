package memogit

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// FindRoot walks up from dir looking for a .memogit directory and returns the
// repo root. Used by pull/push/status which must run inside a cloned repo.
func FindRoot(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for {
		if fi, err := os.Stat(filepath.Join(abs, MetaDir)); err == nil && fi.IsDir() {
			return abs, nil
		}
		parent := filepath.Dir(abs)
		if parent == abs {
			return "", fmt.Errorf("not a memogit repo (no %s found in %s or any parent)", MetaDir, dir)
		}
		abs = parent
	}
}

// writeGitignore ensures the token-bearing config is never committed while the
// sync baseline is tracked.
func writeGitignore(root string) error {
	content := "# memogit: never commit the PAT; keep the sync baseline tracked.\n" +
		MetaDir + "/" + ConfigFile + "\n" +
		"# conflict sidecars (server version for IDE merge) are transient.\n" +
		"*" + conflictSuffix + "\n"
	return os.WriteFile(filepath.Join(root, ".gitignore"), []byte(content), 0o644)
}

// git runs a git subcommand in root and returns combined output.
func git(root string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, out)
	}
	return string(out), nil
}

// GitInitIfNeeded initializes a git repo at root if one doesn't exist yet.
func GitInitIfNeeded(root string) error {
	if fi, err := os.Stat(filepath.Join(root, ".git")); err == nil && fi.IsDir() {
		return nil
	}
	if _, err := git(root, "init"); err != nil {
		return err
	}
	return nil
}

// fallbackGitName/Email are used when neither the machine nor the memogit
// account provides a git identity — without one `git commit` hard-fails on a
// fresh box that never ran `git config --global user.email`.
const (
	fallbackGitName  = "memogit"
	fallbackGitEmail = "memogit@localhost"
)

// gitHasIdentity reports whether git can resolve a committer identity in root
// (from any config scope, or the environment).
func gitHasIdentity(root string) bool {
	_, err := git(root, "var", "GIT_COMMITTER_IDENT")
	return err == nil
}

// EnsureGitIdentity writes a repo-local user.name/user.email when the machine
// has no git identity configured, so the baseline commit succeeds on a fresh
// host. name/email come from the memogit account (either may be empty); global
// config, when present, is left untouched.
func EnsureGitIdentity(root, name, email string) error {
	if gitHasIdentity(root) {
		return nil
	}
	if strings.TrimSpace(name) == "" {
		name = fallbackGitName
	}
	if strings.TrimSpace(email) == "" {
		email = fallbackGitEmail
	}
	if _, err := git(root, "config", "user.name", name); err != nil {
		return err
	}
	if _, err := git(root, "config", "user.email", email); err != nil {
		return err
	}
	return nil
}

// commitIdentityArgs returns `-c user.*` overrides for a single commit when the
// repo still has no identity (e.g. a checkout cloned before EnsureGitIdentity
// existed), so pull/push can commit without mutating the user's config.
func commitIdentityArgs(root string) []string {
	if gitHasIdentity(root) {
		return nil
	}
	return []string{"-c", "user.name=" + fallbackGitName, "-c", "user.email=" + fallbackGitEmail}
}

// GitStatusPorcelain returns the number of entries in `git status --porcelain`
// (uncommitted working-tree changes), or 0 if git errors.
func GitStatusPorcelain(root string) int {
	out, err := git(root, "status", "--porcelain")
	if err != nil {
		return 0
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return 0
	}
	return len(strings.Split(out, "\n"))
}

// GitCommitAll stages everything and commits with msg. It is a no-op (returns
// nil) when there is nothing to commit.
func GitCommitAll(root, msg string) error {
	if _, err := git(root, "add", "-A"); err != nil {
		return err
	}
	// Nothing staged → skip commit without erroring.
	if out, _ := git(root, "status", "--porcelain"); strings.TrimSpace(out) == "" {
		return nil
	}
	args := append(commitIdentityArgs(root), "commit", "-m", msg)
	if _, err := git(root, args...); err != nil {
		return err
	}
	return nil
}
