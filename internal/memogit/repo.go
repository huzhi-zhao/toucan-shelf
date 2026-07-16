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
	if _, err := git(root, "commit", "-m", msg); err != nil {
		return err
	}
	return nil
}
