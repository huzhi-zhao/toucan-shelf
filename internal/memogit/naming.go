package memogit

import (
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// extForDocType maps a doc type to the local file extension. The local tree
// mirrors the server hierarchy; the extension encodes the doc type so push can
// recover it and so editors/AI treat each file correctly.
func extForDocType(docType string) string {
	switch docType {
	case "HTML":
		return ".html"
	case "PDF":
		// No editable body; a reference stub with a .pdf.md name so it's still
		// browsable as markdown while clearly marking the PDF origin.
		return ".pdf.md"
	case "VIEW":
		// Gallery config JSON, not markdown.
		return ".view.json"
	case "BLOGVIEW":
		// A site home page's composition. Same JSON shape as a view, different
		// block vocabulary — the extension says which one an editor is holding.
		return ".blogview.json"
	default: // MARKDOWN
		return ".md"
	}
}

// untitled is the filename stem used when a document has no title.
const untitled = "untitled"

// sanitizeSegment makes one path segment (a folder name or the title stem)
// safe for the filesystem: it strips path separators and reserved characters
// and collapses surrounding whitespace, while preserving Unicode (CJK) letters.
func sanitizeSegment(s string) string {
	s = strings.TrimSpace(s)
	// Replace characters that are path separators or reserved on common
	// filesystems (Windows: <>:"/\|?*) plus control chars.
	var b strings.Builder
	for _, r := range s {
		switch {
		case r < 0x20: // control
			// drop
		case strings.ContainsRune(`<>:"/\|?*`, r):
			b.WriteRune('-')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	// Avoid names that are all dots (".", "..") which are path-traversal traps.
	if out == "" || strings.Trim(out, ".") == "" {
		return ""
	}
	return out
}

// sanitizeFolderPath cleans a slash-separated folder path segment by segment,
// dropping empty/".."-only parts so the result can never escape the repo root.
func sanitizeFolderPath(folderPath string) string {
	folderPath = strings.Trim(folderPath, "/")
	if folderPath == "" {
		return ""
	}
	var parts []string
	for _, seg := range strings.Split(folderPath, "/") {
		if clean := sanitizeSegment(seg); clean != "" {
			parts = append(parts, clean)
		}
	}
	// path.Join + Clean as a final guard against any residual traversal.
	joined := path.Join(parts...)
	joined = strings.TrimPrefix(path.Clean("/"+joined), "/")
	if joined == "." {
		return ""
	}
	return joined
}

// inScope reports whether a memo at the given server folder_path belongs to this
// checkout. A full checkout (no Sparse, no Folders) includes everything; a sparse
// checkout includes only the mapped folder itself and anything beneath it, and a
// folder-scoped one anything under one of its Folders.
func (w *WorkspaceConfig) inScope(serverFolder string) bool {
	if w.Sparse == "" && len(w.Folders) == 0 {
		return true
	}
	serverFolder = strings.Trim(serverFolder, "/")
	if w.Sparse != "" {
		return underFolder(serverFolder, w.Sparse)
	}
	for _, folder := range w.Folders {
		if underFolder(serverFolder, folder) {
			return true
		}
	}
	return false
}

// underFolder reports whether folder is prefix itself or lies beneath it; a
// name that merely starts with prefix ("HomeWork" vs "Home") does not count.
func underFolder(folder, prefix string) bool {
	return folder == prefix || strings.HasPrefix(folder, prefix+"/")
}

// outOfScope reports the server folder a work-tree file would be pushed to, and
// whether that folder lies outside the checkout. Push refuses such files: the
// document would be created (or moved) on the server, then dropped from the
// checkout by the next pull, so the file would seem to vanish.
func (w *WorkspaceConfig) outOfScope(relPath string) (string, bool) {
	folder, _, _ := deriveMemoFromPath(relPath)
	server := w.ServerFolderPath(folder)
	return server, !w.inScope(server)
}

// scopeLabel describes what a scoped checkout covers, for messages.
func (w *WorkspaceConfig) scopeLabel() string {
	if w.Sparse != "" {
		return fmt.Sprintf("folder %q", w.Sparse)
	}
	return fmt.Sprintf("folders %s", strings.Join(quoteAll(w.Folders), ", "))
}

func quoteAll(items []string) []string {
	out := make([]string, len(items))
	for i, s := range items {
		out[i] = strconv.Quote(s)
	}
	return out
}

// NormalizeFolders turns the folder list of a memogit.conf.yaml entry into the
// form WorkspaceConfig.Folders keeps: slashes trimmed, duplicates dropped, a
// folder already covered by another one in the list dropped, sorted. Names are
// matched against the server's folder_path as-is (case-sensitive) and are not
// sanitized, since a sanitized name could stop matching the server's. A name
// that cannot be a server folder — empty, "." or ".." segments, a hidden or
// the reserved sub-document folder — is an error rather than silently skipped.
func NormalizeFolders(folders []string) ([]string, error) {
	var clean []string
	for _, raw := range folders {
		f := strings.Trim(strings.TrimSpace(raw), "/")
		if f == "" {
			return nil, fmt.Errorf("folders: empty folder name")
		}
		for _, seg := range strings.Split(f, "/") {
			if seg == "" || seg == "." || seg == ".." || strings.HasPrefix(seg, ".") {
				return nil, fmt.Errorf("folders: %q is not a folder path (no empty, \".\", \"..\" or hidden segments)", raw)
			}
		}
		if f == SubDocFolderPrefix || strings.HasPrefix(f, SubDocFolderPrefix+"/") {
			return nil, fmt.Errorf("folders: %q is the reserved sub-document folder; sub-documents follow their parent", raw)
		}
		clean = append(clean, f)
	}
	sort.Strings(clean)
	var out []string
	for _, f := range clean {
		covered := false
		for _, kept := range out {
			if underFolder(f, kept) {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, f)
		}
	}
	return out, nil
}

// LocalRelPath is the repo-relative file path for a memo. For a sparse checkout
// it is scoped to the mapped folder (see inScope) and, unless SparseSubdir is
// set, has that folder's prefix stripped so its contents sit at the checkout
// root; with SparseSubdir the folder is kept as-is, so the local tree mirrors
// the server folder_path exactly.
func (w *WorkspaceConfig) LocalRelPath(serverFolder, title, docType string) string {
	if w.Sparse != "" && w.SparseSubdir {
		return RelPath(serverFolder, title, docType)
	}
	return RelPath(w.stripSparse(serverFolder), title, docType)
}

// ServerFolderPath is the inverse of LocalRelPath's mapping: it recovers the
// server folder_path from a locally-derived folder so push targets the right
// place. Used when creating memos found under a sparse checkout. With
// SparseSubdir the local folder already is the server folder_path (nothing to
// re-add); otherwise the stripped prefix is prepended back.
func (w *WorkspaceConfig) ServerFolderPath(localFolder string) string {
	localFolder = strings.Trim(filepath.ToSlash(localFolder), "/")
	if w.Sparse == "" || w.SparseSubdir {
		return localFolder
	}
	if localFolder == "" {
		return w.Sparse
	}
	return w.Sparse + "/" + localFolder
}

// stripSparse removes the sparse folder prefix from a server folder_path.
func (w *WorkspaceConfig) stripSparse(serverFolder string) string {
	if w.Sparse == "" {
		return serverFolder
	}
	serverFolder = strings.Trim(serverFolder, "/")
	if serverFolder == w.Sparse {
		return ""
	}
	return strings.TrimPrefix(serverFolder, w.Sparse+"/")
}

// RelPath computes the repo-relative file path for a document from its server
// folder_path, title, and doc type: "<folder_path>/<title><ext>". The server
// enforces uniqueness on (workspace, folder_path, title), so this path is
// unique without needing the uid.
func RelPath(folderPath, title, docType string) string {
	stem := sanitizeSegment(title)
	if stem == "" {
		stem = untitled
	}
	name := stem + extForDocType(docType)
	if dir := sanitizeFolderPath(folderPath); dir != "" {
		return filepath.Join(filepath.FromSlash(dir), name)
	}
	return name
}
