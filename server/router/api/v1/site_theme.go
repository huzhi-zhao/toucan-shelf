package v1

import (
	"encoding/json"
	"regexp"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// A site's theme is a bounded set of named values, never a stylesheet.
//
// The keys below are exactly the custom properties the blog skin reads
// (web/src/components/BlogSite/blog.css); the front end writes each one as
// `--blog-<key>` on the site's root element. Both halves of the check matter and
// both are done here rather than in the browser: an unknown key would be a value
// nobody validated, and an unchecked value on a page served to anonymous readers
// is stored XSS. A request can skip the front end; it cannot skip this.
type themeValueKind int

const (
	themeColor themeValueKind = iota
	themeLength
	themeFontStack
)

var siteThemeKeys = map[string]themeValueKind{
	"bg":           themeColor,
	"surface":      themeColor,
	"ink":          themeColor,
	"ink-soft":     themeColor,
	"ink-muted":    themeColor,
	"hairline":     themeColor,
	"accent":       themeColor,
	"accent-soft":  themeColor,
	"font-display": themeFontStack,
	"font-body":    themeFontStack,
	"cover-radius": themeLength,
	"shell-max":    themeLength,
	"gutter":       themeLength,
	"prose-max":    themeLength,
}

var (
	// Hex, or one of the four functional colour notations with nothing but
	// numbers, separators and percent signs inside.
	themeColorPattern = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%/ \t]+\))$`)
	// A plain number and unit. Deliberately no calc()/clamp(): the defaults that
	// need them live in the stylesheet, and an override does not.
	themeLengthPattern = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?(px|rem|em|ch|vw|%)$`)
	// A font-family list: names, quotes and commas. No parentheses, so `url(…)`
	// cannot appear.
	themeFontStackPattern = regexp.MustCompile(`^[-0-9A-Za-z_ ,.'"]+$`)
)

// validateSiteTheme rejects anything that is not a whitelisted key carrying a
// value of that key's shape.
func validateSiteTheme(theme string) error {
	if strings.TrimSpace(theme) == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(theme), &parsed); err != nil {
		return status.Errorf(codes.InvalidArgument, "theme must be a JSON object")
	}
	for key, raw := range parsed {
		kind, ok := siteThemeKeys[key]
		if !ok {
			return status.Errorf(codes.InvalidArgument, "unknown theme key %q", key)
		}
		value, ok := raw.(string)
		if !ok {
			return status.Errorf(codes.InvalidArgument, "theme key %q must be a string", key)
		}
		value = strings.TrimSpace(value)
		if len(value) > 200 {
			return status.Errorf(codes.InvalidArgument, "theme key %q is too long", key)
		}
		var pattern *regexp.Regexp
		switch kind {
		case themeColor:
			pattern = themeColorPattern
		case themeLength:
			pattern = themeLengthPattern
		case themeFontStack:
			pattern = themeFontStackPattern
		}
		if !pattern.MatchString(value) {
			return status.Errorf(codes.InvalidArgument, "theme key %q has an invalid value", key)
		}
	}
	return nil
}

// defaultSiteMenu is what a new site starts with. English, like every other
// built-in string on a published site (requirements §9) — and only a starting
// point: the author may delete or add entries.
func defaultSiteMenu() []*v1pb.SiteMenuItem {
	return []*v1pb.SiteMenuItem{
		{Label: "Latest", Path: ""},
		{Label: "Search", Path: "search"},
	}
}

// siteMenuPathPattern keeps a menu entry pointing inside the site. An absolute
// URL here would turn the site's own navigation into an off-site link list, and
// `javascript:` would turn it into a script.
var siteMenuPathPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// encodeSiteMenu validates a menu and returns it as the JSON stored on the site.
func encodeSiteMenu(items []*v1pb.SiteMenuItem) (string, error) {
	if len(items) > 12 {
		return "", status.Errorf(codes.InvalidArgument, "a site menu may hold at most 12 entries")
	}
	encoded := make([]storedMenuItem, 0, len(items))
	for _, item := range items {
		label := strings.TrimSpace(item.GetLabel())
		if label == "" {
			return "", status.Errorf(codes.InvalidArgument, "a menu entry needs a label")
		}
		if len(label) > 40 {
			return "", status.Errorf(codes.InvalidArgument, "menu label %q is too long", label)
		}
		path := strings.TrimSpace(item.GetPath())
		if path != "" && !siteMenuPathPattern.MatchString(path) {
			return "", status.Errorf(codes.InvalidArgument, "menu path %q must be a slug within this site", path)
		}
		encoded = append(encoded, storedMenuItem{Label: label, Path: path})
	}
	blob, err := json.Marshal(encoded)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to encode menu: %v", err)
	}
	return string(blob), nil
}

type storedMenuItem struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

// decodeSiteMenu reads the stored menu. A menu that will not parse is served as
// an empty one: a site whose navigation is broken should still render its pages.
func decodeSiteMenu(blob string) []*v1pb.SiteMenuItem {
	if strings.TrimSpace(blob) == "" {
		return nil
	}
	var stored []storedMenuItem
	if err := json.Unmarshal([]byte(blob), &stored); err != nil {
		return nil
	}
	items := make([]*v1pb.SiteMenuItem, 0, len(stored))
	for _, item := range stored {
		if strings.TrimSpace(item.Label) == "" {
			continue
		}
		items = append(items, &v1pb.SiteMenuItem{Label: item.Label, Path: item.Path})
	}
	return items
}
