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

// absoluteMemoHrefRe matches the path component "/memos/{uid}" at the end of
// a site-absolute path or full URL.
var absoluteMemoHrefRe = regexp.MustCompile(`^/memos/([^/?#]+)$`)

// ResolveAbsoluteMemoHref extracts the memo uid from an absolute-form link:
// either a site-absolute path ("/memos/{uid}") or a full URL
// ("{host}/memos/{uid}"). This is the compat form produced by "copy link";
// it returns ok == false for any other href shape, including canonical
// root-relative doc paths (use ResolveRootRelativePath for those).
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

// IsRootRelativeDocHref reports whether href has the canonical in-workspace
// link shape per docs/dev/requirements/cross-reference-repair-on-move-rename.md
// ("链接的规范形式"): a site-absolute path (leading "/") that is not the
// /memos/{uid} compat form. Callers should check ResolveAbsoluteMemoHref
// first; this only decides whether ResolveRootRelativePath is worth trying.
//
// Deliberately NOT accepted here (per the 2026-08-07 requirements rewrite):
// scheme-qualified URLs, bare fragments, and plain relative paths with no
// leading "/" — the old relative-path-with-title-fallback scheme is retired,
// not merely deprioritized.
func IsRootRelativeDocHref(href string) bool {
	if href == "" || !strings.HasPrefix(href, "/") {
		return false
	}
	if _, ok := ResolveAbsoluteMemoHref(href); ok {
		return false
	}
	return true
}

// ResolveRootRelativePath resolves a workspace-root-relative href
// ("/doc/api.md") to a target memo uid. This ports resolveWorkspacePath from
// web/src/components/MemoContent/DocumentLinkContext.tsx: the final path
// segment is matched against a document title (extension-agnostic,
// case-insensitive), the leading segments are matched against folder names
// exactly, and the match is against the workspace root — never relative to
// the linking document's own folder, unlike the old scheme.
//
// There is no fallback: a path that doesn't resolve is a broken link, not a
// cue to search the rest of the tree by title. Any change here must be
// mirrored in resolveWorkspacePath on the frontend, or the two will disagree
// about which links are broken.
func ResolveRootRelativePath(tree []*TreeNode, href string) (string, bool) {
	path := href
	if decoded, err := url.PathUnescape(href); err == nil {
		path = decoded
	}
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		path = path[:idx]
	}
	segments := splitPath(path)
	if len(segments) == 0 {
		return "", false
	}
	title := stripExt(segments[len(segments)-1])
	folderSegments := segments[:len(segments)-1]
	return findDocInFolder(tree, folderSegments, title)
}

// CanonicalHref builds the canonical workspace-root-relative href for a
// document living at folderPath with the given title. It is a pure function
// of the target's own location — never of the document doing the linking —
// which is the whole point of the root-relative scheme: every referencer of
// a given target computes the same value, and the linking document's own
// outbound hrefs never need touching when the linking document itself moves.
//
// The result is percent-encoded per segment (see escapePathSegments), so it
// is always a valid bare markdown link destination.
func CanonicalHref(folderPath, title string) string {
	segments := append(append([]string{}, splitPath(folderPath)...), title)
	return escapePathSegments(segments)
}

// RewritePathPrefix replaces the oldFolderPath prefix of href's path with
// newFolderPath, for folder rename/move (P5) repairs where the fix is a
// straight path-prefix swap rather than a full CanonicalHref recompute (the
// document's title segment, and any deeper subtree structure, is untouched).
// Returns ok == false when href isn't a root-relative path whose path is
// exactly oldFolderPath or nested under it.
func RewritePathPrefix(href, oldFolderPath, newFolderPath string) (string, bool) {
	path := href
	suffix := ""
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		suffix = path[idx:]
		path = path[:idx]
	}
	decoded := path
	if unescaped, err := url.PathUnescape(path); err == nil {
		decoded = unescaped
	}
	if !strings.HasPrefix(decoded, "/") {
		return href, false
	}

	segments := splitPath(decoded)
	oldSegments := splitPath(oldFolderPath)
	if len(segments) <= len(oldSegments) {
		return href, false
	}
	for i, seg := range oldSegments {
		if seg != segments[i] {
			return href, false
		}
	}

	newSegments := append(append([]string{}, splitPath(newFolderPath)...), segments[len(oldSegments):]...)
	return escapePathSegments(newSegments) + suffix, true
}

// escapePathSegments joins already-decoded path segments into a root-relative
// href, percent-encoding each one.
//
// Percent-encoding rather than CommonMark's "<...>" escape hatch: a bare link
// destination stops at the first space, so `[x](/docs/Long Report.md)` doesn't
// parse as a link at all — the destination becomes "/docs/Long" and the rest
// leaks into the visible text. Angle brackets would fix the parse, but they
// only survive as long as nothing re-renders or hand-edits the line, and any
// other producer of these links (import, paste, memogit) would have to know
// the same trick. A percent-encoded destination is unambiguous everywhere and
// is what both resolvers already decode on the way in.
//
// Only the characters that actually break the parse are encoded, NOT
// url.PathEscape's full set: a Chinese folder name is perfectly valid in a
// link destination, and "/设计/api" beats "/%E8%AE%BE%E8%AE%A1/api" for
// anything a human has to read, diff, or hand-edit. "%" goes first so the
// encoding round-trips.
var destinationEscaper = strings.NewReplacer(
	"%", "%25",
	" ", "%20",
	"\t", "%09",
	"(", "%28",
	")", "%29",
	"<", "%3C",
	">", "%3E",
)

func escapePathSegments(segments []string) string {
	escaped := make([]string, 0, len(segments))
	for _, seg := range segments {
		escaped = append(escaped, destinationEscaper.Replace(seg))
	}
	return "/" + strings.Join(escaped, "/")
}

// HrefForm is the path form a markdown link destination is written in. The
// four in-app forms are named in docs/dev/requirements/document-reference-forms.md.
type HrefForm string

const (
	// FormAbsoluteMemo is the "/memos/{uid}" compat form.
	FormAbsoluteMemo HrefForm = "absoluteMemo"
	// FormRootRelative is the canonical "/fa/db.md" form (库根相对路径).
	FormRootRelative HrefForm = "rootRelative"
	// FormRelativeExplicit is a "./" or "../" prefixed path (文档相对路径,
	// 显式形式). It is unambiguously a document reference: if it doesn't
	// resolve, it is a broken link.
	FormRelativeExplicit HrefForm = "relativeExplicit"
	// FormRelativeBare is a relative path with no "./" prefix ("db.md",
	// "sub/dd.md"). It is *probably* a document reference, but it is
	// indistinguishable from a schemeless external destination such as
	// "example.com/page", so renderers must fall back to external-link
	// behaviour when it doesn't resolve rather than showing a broken link.
	FormRelativeBare HrefForm = "relativeBare"
	// FormExternal is everything else: scheme-qualified URLs, bare fragments,
	// queries, the empty string, and "@"-prefixed hrefs (reserved for the
	// workspace-qualified form, 库限定路径).
	FormExternal HrefForm = "external"
)

// hasSchemeRe matches a URI scheme prefix ("https:", "mailto:") per RFC 3986.
var hasSchemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.\-]*:`)

// ClassifyDocHref decides which path form href is written in. It is the single
// dispatch point every caller should use, so that the precedence between the
// forms is stated once instead of being re-derived at each call site.
//
// Mirrored by classifyDocHref in
// web/src/components/MemoContent/DocumentLinkContext.tsx. The shared cases in
// testdata/resolve_cases.json pin the two implementations together.
func ClassifyDocHref(href string) HrefForm {
	if href == "" {
		return FormExternal
	}
	if _, ok := ResolveAbsoluteMemoHref(href); ok {
		return FormAbsoluteMemo
	}
	if strings.HasPrefix(href, "/") {
		return FormRootRelative
	}
	// "@" is reserved for the workspace-qualified form. Excluded here up front
	// so a cross-workspace href is never silently resolved as an in-workspace
	// relative path (which would render it as a broken link in its own
	// workspace instead of reaching the other one).
	if strings.HasPrefix(href, "#") || strings.HasPrefix(href, "?") || strings.HasPrefix(href, "@") {
		return FormExternal
	}
	if hasSchemeRe.MatchString(href) {
		return FormExternal
	}
	if strings.HasPrefix(href, "./") || strings.HasPrefix(href, "../") {
		return FormRelativeExplicit
	}
	return FormRelativeBare
}

// IsRelativeDocHref reports whether href is a document-relative path
// (文档相对路径), in either its explicit or bare form.
func IsRelativeDocHref(href string) bool {
	form := ClassifyDocHref(href)
	return form == FormRelativeExplicit || form == FormRelativeBare
}

// ResolveRelativePath resolves a document-relative href against the folder the
// *referencing* document lives in, and returns the target memo uid.
//
// baseFolderPath is the referencing document's own FolderPath ("" at the
// workspace root). "." segments are dropped and ".." pops one folder; a ".."
// that would climb above the workspace root fails rather than clamping, so a
// path can never address anything outside its own workspace — cross-workspace
// document-relative paths are deliberately not supported.
//
// Once the segments are normalised, matching is identical to
// ResolveRootRelativePath: exact folder names, then a case-insensitive,
// extension-stripped title match among that folder's direct children. There is
// no fallback. Any change here must be mirrored in resolveRelativePath on the
// frontend.
func ResolveRelativePath(tree []*TreeNode, baseFolderPath, href string) (string, bool) {
	path := href
	if decoded, err := url.PathUnescape(href); err == nil {
		path = decoded
	}
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		path = path[:idx]
	}

	segments, ok := normalizeRelativeSegments(splitPath(baseFolderPath), splitPath(path))
	if !ok || len(segments) == 0 {
		return "", false
	}
	title := stripExt(segments[len(segments)-1])
	return findDocInFolder(tree, segments[:len(segments)-1], title)
}

// normalizeRelativeSegments applies relSegments to baseSegments, resolving "."
// and "..". ok is false when a ".." climbs above the workspace root.
func normalizeRelativeSegments(baseSegments, relSegments []string) ([]string, bool) {
	out := append([]string{}, baseSegments...)
	for _, seg := range relSegments {
		switch seg {
		case ".":
			continue
		case "..":
			if len(out) == 0 {
				return nil, false
			}
			out = out[:len(out)-1]
		default:
			out = append(out, seg)
		}
	}
	return out, true
}

// ResolveRelativeToCanonical resolves a document-relative href against
// baseFolderPath and returns the equivalent workspace-root-relative href,
// without consulting the tree. Used to "fossilize" a document's own outbound
// relative links when that document itself moves: the target didn't move, so
// the link must keep pointing where it pointed before, which the authored
// relative form no longer does.
func ResolveRelativeToCanonical(baseFolderPath, href string) (string, bool) {
	path := href
	if decoded, err := url.PathUnescape(href); err == nil {
		path = decoded
	}
	suffix := ""
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		suffix = path[idx:]
		path = path[:idx]
	}
	segments, ok := normalizeRelativeSegments(splitPath(baseFolderPath), splitPath(path))
	if !ok || len(segments) == 0 {
		return "", false
	}
	return escapePathSegments(segments) + suffix, true
}

// ResolveInWorkspace resolves any in-workspace document href form against a
// workspace tree: the canonical root-relative form, or a document-relative
// form interpreted against baseFolderPath (the FolderPath of the document the
// markdown came from). It deliberately does NOT handle the "/memos/{uid}"
// compat form: that one resolves by uid without a tree and may point outside
// this workspace, so callers handle it first with ResolveAbsoluteMemoHref.
//
// Mirrors resolveInWorkspace in
// web/src/components/MemoContent/DocumentLinkContext.tsx.
func ResolveInWorkspace(tree []*TreeNode, baseFolderPath, href string) (string, bool) {
	switch ClassifyDocHref(href) {
	case FormRootRelative:
		return ResolveRootRelativePath(tree, href)
	case FormRelativeExplicit, FormRelativeBare:
		return ResolveRelativePath(tree, baseFolderPath, href)
	default:
		return "", false
	}
}

// IsInWorkspaceDocHref reports whether href is one of the in-workspace path
// forms that ResolveInWorkspace can resolve (root-relative or
// document-relative). Callers use it to skip building a workspace tree for
// hrefs that could never resolve against one.
func IsInWorkspaceDocHref(href string) bool {
	switch ClassifyDocHref(href) {
	case FormRootRelative, FormRelativeExplicit, FormRelativeBare:
		return true
	default:
		return false
	}
}
