// Package publish holds the content-side pieces of the public publishing
// pipeline: slug generation, secret-block removal and link rewriting. Everything
// here is pure — the database work and permission checks live in the API
// service that drives it.
package publish

import (
	"strconv"
	"strings"
	"unicode"
)

// maxSlugRunes caps a generated slug. Slugs end up in every external link to a
// page, so keep them short enough to read.
const maxSlugRunes = 60

// reservedSlugs are the path segments a site keeps for itself. A slug that took
// one of these would knock out the site's own search page or short-link prefix,
// so both generation and manual edits are checked against this set.
var reservedSlugs = map[string]struct{}{
	"":            {},
	"d":           {},
	"search":      {},
	"tags":        {},
	"tag":         {},
	"assets":      {},
	"static":      {},
	"api":         {},
	"file":        {},
	"sitemap.xml": {},
	"robots.txt":  {},
	"favicon.ico": {},
}

// IsReservedSlug reports whether slug collides with a path the site reserves.
func IsReservedSlug(slug string) bool {
	_, ok := reservedSlugs[strings.ToLower(slug)]
	return ok
}

// NormalizeSlug turns arbitrary text into a slug candidate: lower-case ASCII
// letters and digits, single hyphens between words. It returns "" when the input
// has nothing usable — a CJK-only title, for instance, which is why callers must
// always have a fallback (see GenerateSlug).
func NormalizeSlug(text string) string {
	var b strings.Builder
	lastHyphen := true // leading hyphens are suppressed
	n := 0
	for _, r := range strings.ToLower(text) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastHyphen = false
			n++
		case r == '-' || r == '_' || unicode.IsSpace(r):
			if !lastHyphen && n > 0 {
				b.WriteRune('-')
				lastHyphen = true
				n++
			}
		default:
			// Everything else (CJK, punctuation, emoji) is dropped; a title made
			// entirely of such runes yields "" and falls back to the doc id.
		}
		if n >= maxSlugRunes {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}

// ValidateSlug checks a slug a user typed by hand. Unlike generation, a manual
// slug is rejected rather than silently rewritten: the author asked for a
// specific URL and should be told when they cannot have it.
func ValidateSlug(slug string) error {
	if slug == "" {
		return ErrSlugEmpty
	}
	if IsReservedSlug(slug) {
		return ErrSlugReserved
	}
	if NormalizeSlug(slug) != slug {
		return ErrSlugInvalidChars
	}
	return nil
}

// GenerateSlug produces the slug for a document's first publication on a site.
// It is called once and the result is frozen: regenerating on a title change
// would break every external link.
//
// base is the preferred candidate (a translated title, when one is available);
// title is the raw document title; docUID is the fallback for titles that
// normalize to nothing. taken reports whether a candidate is already used on
// this site — a collision is resolved by appending a counter rather than by
// failing, because two workspaces holding a same-named document is expected
// once a site aggregates several of them.
func GenerateSlug(base, title, docUID string, taken func(string) bool) string {
	candidate := NormalizeSlug(base)
	if candidate == "" {
		candidate = NormalizeSlug(title)
	}
	if candidate == "" || IsReservedSlug(candidate) {
		// No usable characters (a CJK-only title with no translation available,
		// say). The doc id is meaningless to read but never fails, which is what
		// the fallback is for: an unavailable translator must not block a publish.
		candidate = "d-" + shortUID(docUID)
	}
	if !taken(candidate) {
		return candidate
	}
	for i := 2; ; i++ {
		next := candidate + "-" + strconv.Itoa(i)
		if !taken(next) {
			return next
		}
	}
}

// shortUID takes the leading part of a document uid, enough to stay unique in
// practice while keeping the URL short.
func shortUID(uid string) string {
	if len(uid) > 8 {
		return uid[:8]
	}
	if uid == "" {
		return "doc"
	}
	return uid
}
