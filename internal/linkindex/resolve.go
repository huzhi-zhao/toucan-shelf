package linkindex

import (
	"net/url"
	"regexp"
	"strings"
)

var extRe = regexp.MustCompile(`(?i)\.(md|markdown|html?|pdf)$`)

func stripExt(v string) string {
	return extRe.ReplaceAllString(v, "")
}

func normalizedTitle(v string) string {
	return strings.ToLower(stripExt(v))
}

// findDocByTitle does a case-insensitive, extension-stripped title match
// anywhere in the tree (DFS), mirroring the frontend's findDocByTitle.
func findDocByTitle(nodes []*TreeNode, title string) (string, bool) {
	target := normalizedTitle(title)
	for _, n := range nodes {
		if !n.IsFolder && normalizedTitle(n.Name) == target {
			return n.UID, true
		}
		if n.IsFolder {
			if uid, ok := findDocByTitle(n.Children, title); ok {
				return uid, true
			}
		}
	}
	return "", false
}

// findDocInFolder walks folderSegments as exact-name folder matches, then
// does a case-insensitive, extension-stripped title match among that
// folder's direct children, mirroring the frontend's findDocInFolder.
func findDocInFolder(tree []*TreeNode, folderSegments []string, title string) (string, bool) {
	nodes := tree
	for _, seg := range folderSegments {
		var next []*TreeNode
		found := false
		for _, n := range nodes {
			if n.IsFolder && n.Name == seg {
				next = n.Children
				found = true
				break
			}
		}
		if !found {
			return "", false
		}
		nodes = next
	}

	target := normalizedTitle(title)
	for _, n := range nodes {
		if !n.IsFolder && normalizedTitle(n.Name) == target {
			return n.UID, true
		}
	}
	return "", false
}

// IsRelativeDocHref reports whether href is a same-document-tree relative
// path, as opposed to a scheme-qualified URL, a bare fragment (#anchor), or
// a site-absolute path (which is handled by ResolveAbsoluteMemoHref
// instead).
func IsRelativeDocHref(href string) bool {
	if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "/") {
		return false
	}
	if u, err := url.Parse(href); err == nil && u.Scheme != "" {
		return false
	}
	return true
}

// ResolveWorkspacePath ports resolveWorkspacePath from
// web/src/components/MemoContent/DocumentLinkContext.tsx: it resolves a
// relative markdown link href against baseFolderPath (the linking
// document's own folder), falling back to a root-relative match and finally
// to a title match anywhere in the tree. This last fallback is what makes
// relative-path links survive moving the *target* document to a different
// folder.
func ResolveWorkspacePath(tree []*TreeNode, href string, baseFolderPath string) (string, bool) {
	path := href
	if decoded, err := url.QueryUnescape(href); err == nil {
		path = decoded
	}
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		path = path[:idx]
	}
	rawSegments := splitPath(path)
	if len(rawSegments) == 0 {
		return "", false
	}

	title := stripExt(rawSegments[len(rawSegments)-1])
	navSegments := rawSegments[:len(rawSegments)-1]

	resolved := append([]string{}, splitPath(baseFolderPath)...)
	for _, seg := range navSegments {
		switch seg {
		case ".":
			continue
		case "..":
			if len(resolved) > 0 {
				resolved = resolved[:len(resolved)-1]
			}
		default:
			resolved = append(resolved, seg)
		}
	}

	// 1. Relative to the current folder.
	if uid, ok := findDocInFolder(tree, resolved, title); ok {
		return uid, true
	}

	// 2. Relative to the workspace root.
	if len(navSegments) > 0 {
		var rootRelative []string
		for _, s := range navSegments {
			if s != "." && s != ".." {
				rootRelative = append(rootRelative, s)
			}
		}
		if uid, ok := findDocInFolder(tree, rootRelative, title); ok {
			return uid, true
		}
	}

	// 3. Last resort: title match anywhere in the tree.
	return findDocByTitle(tree, title)
}

// absoluteMemoHrefRe matches the path component "/memos/{uid}" at the end of
// a site-absolute path or full URL.
var absoluteMemoHrefRe = regexp.MustCompile(`^/memos/([^/?#]+)$`)

// ResolveAbsoluteMemoHref extracts the memo uid from an absolute-form link:
// either a site-absolute path ("/memos/{uid}") or a full URL
// ("{host}/memos/{uid}"). It returns ok == false for any other href shape,
// including relative paths (use ResolveWorkspacePath for those).
func ResolveAbsoluteMemoHref(href string) (string, bool) {
	h := href
	if idx := strings.IndexAny(h, "?#"); idx >= 0 {
		h = h[:idx]
	}
	if u, err := url.Parse(h); err == nil && u.Scheme != "" {
		h = u.Path
	}
	if !strings.HasPrefix(h, "/") {
		return "", false
	}
	m := absoluteMemoHrefRe.FindStringSubmatch(h)
	if m == nil {
		return "", false
	}
	if uid, err := url.PathUnescape(m[1]); err == nil {
		return uid, true
	}
	return m[1], true
}
