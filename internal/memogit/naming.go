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
