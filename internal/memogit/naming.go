package memogit

import (
	"path"
	"path/filepath"
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
// checkout. A full checkout (Sparse == "") includes everything; a sparse checkout
// includes only the mapped folder itself and anything beneath it.
func (w *WorkspaceConfig) inScope(serverFolder string) bool {
	if w.Sparse == "" {
		return true
	}
	serverFolder = strings.Trim(serverFolder, "/")
	return serverFolder == w.Sparse || strings.HasPrefix(serverFolder, w.Sparse+"/")
}

// LocalRelPath is the repo-relative file path for a memo, with the sparse folder
// prefix (if any) stripped so a sparse checkout's files sit at its root.
func (w *WorkspaceConfig) LocalRelPath(serverFolder, title, docType string) string {
	return RelPath(w.stripSparse(serverFolder), title, docType)
}

// ServerFolderPath is the inverse of the strip done by LocalRelPath: it prepends
// the sparse prefix to a locally-derived folder so push targets the right server
// folder_path. Used when creating memos found under a sparse checkout.
func (w *WorkspaceConfig) ServerFolderPath(localFolder string) string {
	localFolder = strings.Trim(filepath.ToSlash(localFolder), "/")
	if w.Sparse == "" {
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
