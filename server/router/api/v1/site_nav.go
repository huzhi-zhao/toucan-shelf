package v1

import (
	"encoding/json"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The navigation tree is authored, not derived: a published URL is flat and a
// site may aggregate several knowledge bases, so there is no folder structure
// to read a tree out of. These caps keep one site's configuration from turning
// into an unbounded document — a tree deeper or wider than this is a table of
// contents nobody navigates anyway.
const (
	maxNavDepth = 4
	maxNavNodes = 400
)

type storedNavItem struct {
	Label    string          `json:"label"`
	Slug     string          `json:"slug,omitempty"`
	Children []storedNavItem `json:"children,omitempty"`
}

// encodeSiteNav validates a navigation tree and returns it as the JSON stored
// on the site. A node's slug is checked to be a slug within this site for the
// same reason a menu path is: the tree is in-site navigation, and an absolute
// URL or a `javascript:` value here would make it something else.
func encodeSiteNav(items []*v1pb.SiteNavItem) (string, error) {
	count := 0
	encoded, err := encodeNavLevel(items, 1, &count)
	if err != nil {
		return "", err
	}
	blob, err := json.Marshal(encoded)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to encode nav: %v", err)
	}
	return string(blob), nil
}

func encodeNavLevel(items []*v1pb.SiteNavItem, depth int, count *int) ([]storedNavItem, error) {
	if len(items) == 0 {
		return []storedNavItem{}, nil
	}
	if depth > maxNavDepth {
		return nil, status.Errorf(codes.InvalidArgument, "the navigation tree may be at most %d levels deep", maxNavDepth)
	}
	encoded := make([]storedNavItem, 0, len(items))
	for _, item := range items {
		*count++
		if *count > maxNavNodes {
			return nil, status.Errorf(codes.InvalidArgument, "the navigation tree may hold at most %d entries", maxNavNodes)
		}
		label := strings.TrimSpace(item.GetLabel())
		if label == "" {
			return nil, status.Errorf(codes.InvalidArgument, "a navigation entry needs a label")
		}
		if len(label) > 60 {
			return nil, status.Errorf(codes.InvalidArgument, "navigation label %q is too long", label)
		}
		slug := strings.TrimSpace(item.GetSlug())
		if slug != "" && !siteMenuPathPattern.MatchString(slug) {
			return nil, status.Errorf(codes.InvalidArgument, "navigation slug %q must be a slug within this site", slug)
		}
		children, err := encodeNavLevel(item.GetChildren(), depth+1, count)
		if err != nil {
			return nil, err
		}
		node := storedNavItem{Label: label, Slug: slug}
		if len(children) > 0 {
			node.Children = children
		}
		encoded = append(encoded, node)
	}
	return encoded, nil
}

// decodeSiteNav reads the stored tree. A tree that will not parse is served as
// an empty one: a site whose navigation is broken should still render its pages.
func decodeSiteNav(blob string) []*v1pb.SiteNavItem {
	if strings.TrimSpace(blob) == "" {
		return nil
	}
	var stored []storedNavItem
	if err := json.Unmarshal([]byte(blob), &stored); err != nil {
		return nil
	}
	return convertNavLevel(stored)
}

func convertNavLevel(stored []storedNavItem) []*v1pb.SiteNavItem {
	items := make([]*v1pb.SiteNavItem, 0, len(stored))
	for _, item := range stored {
		if strings.TrimSpace(item.Label) == "" {
			continue
		}
		items = append(items, &v1pb.SiteNavItem{
			Label:    item.Label,
			Slug:     item.Slug,
			Children: convertNavLevel(item.Children),
		})
	}
	return items
}

// pruneNavToPublished drops everything an anonymous reader has no page for.
//
// A node whose slug is not published on this site loses the slug; if it has no
// surviving children either, the node itself goes. The point is that the tree
// never renders a dead link *and* never renders a label for a document that is
// not published — the label alone would say a document exists, which is exactly
// what publishing decides.
func pruneNavToPublished(items []*v1pb.SiteNavItem, published map[string]struct{}) []*v1pb.SiteNavItem {
	kept := make([]*v1pb.SiteNavItem, 0, len(items))
	for _, item := range items {
		children := pruneNavToPublished(item.GetChildren(), published)
		slug := item.GetSlug()
		if slug != "" {
			if _, ok := published[slug]; !ok {
				slug = ""
			}
		}
		if slug == "" && len(children) == 0 {
			continue
		}
		kept = append(kept, &v1pb.SiteNavItem{Label: item.GetLabel(), Slug: slug, Children: children})
	}
	return kept
}
