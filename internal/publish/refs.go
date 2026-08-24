package publish

import (
	"net/url"
	"strings"
)

// attachmentPathPrefix is the path attachments are served under. Snapshot
// references are matched against it to find which files a page pulls in.
const attachmentPathPrefix = "/file/attachments/"

// ParseAttachmentUID returns the attachment uid an href points at, if it is an
// attachment reference at all. Both site-relative hrefs ("/file/attachments/…")
// and absolute ones written against the instance URL are recognised, since the
// editor produces either depending on how the file was inserted.
func ParseAttachmentUID(href string) (string, bool) {
	path := href
	if parsed, err := url.Parse(href); err == nil && parsed.Host != "" {
		path = parsed.Path
	} else if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	if !strings.HasPrefix(path, attachmentPathPrefix) {
		return "", false
	}
	rest := strings.TrimPrefix(path, attachmentPathPrefix)
	uid, _, found := strings.Cut(rest, "/")
	if !found || uid == "" {
		return "", false
	}
	if decoded, err := url.PathUnescape(uid); err == nil {
		uid = decoded
	}
	return uid, true
}

// SiteAttachmentHref rewrites an attachment href so it resolves under the site's
// own origin instead of the main application's. Readers following a link off the
// site to the main app is exactly the seam publishing is supposed to hide.
func SiteAttachmentHref(href string) (string, bool) {
	if _, ok := ParseAttachmentUID(href); !ok {
		return href, false
	}
	path := href
	if parsed, err := url.Parse(href); err == nil && parsed.Host != "" {
		path = parsed.Path
		if parsed.RawQuery != "" {
			path += "?" + parsed.RawQuery
		}
	}
	return path, true
}

// SiteDocHref is the in-site path for a published document.
func SiteDocHref(slug string) string {
	return "/" + slug
}
