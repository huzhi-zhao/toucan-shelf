package memogit

import (
	"os"
	"path/filepath"
	"strings"
)

// conflictSuffix is appended to a document's path to hold the server version
// during a conflict, so an IDE can diff/merge it against the local file. These
// sidecars are git-ignored and skipped by the doc-file scanner.
const conflictSuffix = ".remote"

// conflictSidecarRel returns the sidecar path for a document's repo-relative
// path ("notes/todo.md" -> "notes/todo.md.remote").
func conflictSidecarRel(relPath string) string {
	return relPath + conflictSuffix
}

// isConflictSidecar reports whether a path is a conflict sidecar file.
func isConflictSidecar(relPath string) bool {
	return strings.HasSuffix(relPath, conflictSuffix)
}

// writeConflictSidecar writes the server version of a document next to the
// local file as "<path>.remote" so the user can merge in their editor.
func writeConflictSidecar(contentRoot, relPath, serverContent string) error {
	return writeFile(contentRoot, conflictSidecarRel(relPath), serverContent)
}

// removeConflictSidecar deletes a document's conflict sidecar if present
// (best-effort).
func removeConflictSidecar(contentRoot, relPath string) {
	_ = os.Remove(filepath.Join(contentRoot, conflictSidecarRel(relPath)))
}

// conflictSidecarExists reports whether a document's "<path>.remote" sidecar is
// present on disk — the signal that a detected conflict is not yet resolved.
func conflictSidecarExists(contentRoot, relPath string) bool {
	_, err := os.Stat(filepath.Join(contentRoot, conflictSidecarRel(relPath)))
	return err == nil
}
