package publish

import "encoding/json"

// Sanitizing a `.view` document down to what a site's home page is allowed to
// carry.
//
// A view's stored JSON holds both outward-facing blocks and knowledge-base ones,
// and the knowledge-base blocks are the problem: a gallery's scope spells out
// folder paths and frontmatter property rules, a calendar names the folder new
// documents land in. The reader-facing renderer ignores those block types, but
// "not rendered" is not "not sent" — the snapshot is served verbatim to
// anonymous callers, so the shape of the library would go out in the response
// body of a page that visibly shows none of it.
//
// So the pruning happens here, at publish time, on the server, for the same
// reason the navigation tree is pruned there. And it is a whitelist of fields,
// not only of block types: a field added to an outward block later is invisible
// to this code, and invisible must mean "does not leave".

// Block type tags as written by the in-app view editor.
const (
	viewBlockMarkdown = "markdown"
	viewBlockGallery  = "public_gallery"
	viewBlockFeed     = "public_feed"
)

// SanitizeViewBlocks rewrites a view document's JSON so it carries only the
// outward-facing blocks and only their whitelisted fields.
//
// It reports how many blocks it dropped, so the author can be told that the
// gallery they arranged will not appear on the site rather than being left to
// discover it on the live page. ok is false when the content is not parseable
// view JSON at all, which the caller treats as a hard failure: a home page that
// cannot be read is not something to publish half of.
func SanitizeViewBlocks(content string) (sanitized string, dropped int, ok bool) {
	var doc struct {
		ViewType string            `json:"viewType"`
		Blocks   []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		return "", 0, false
	}

	kept := make([]any, 0, len(doc.Blocks))
	for _, raw := range doc.Blocks {
		block, keep := sanitizeViewBlock(raw)
		if !keep {
			dropped++
			continue
		}
		kept = append(kept, block)
	}

	// Only the two top-level keys the reader needs are re-emitted. Anything else
	// the editor may write up there — now or later — is left behind by default.
	out, err := json.Marshal(map[string]any{"viewType": doc.ViewType, "blocks": kept})
	if err != nil {
		return "", 0, false
	}
	return string(out), dropped, true
}

func sanitizeViewBlock(raw json.RawMessage) (any, bool) {
	var typed struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &typed); err != nil {
		return nil, false
	}
	switch typed.Type {
	case viewBlockMarkdown:
		return sanitizeMarkdownBlock(raw)
	case viewBlockGallery:
		return sanitizeGalleryBlock(raw)
	case viewBlockFeed:
		return sanitizeFeedBlock(raw)
	default:
		// A gallery, calendar, or any block type added after this was written.
		return nil, false
	}
}

// A markdown block may instead reference a knowledge-base document. That
// document was not published by this action — publishing froze the view, not
// what it points at — so the block goes rather than resolving to content the
// author never sent out.
func sanitizeMarkdownBlock(raw json.RawMessage) (any, bool) {
	var block struct {
		Content string `json:"content"`
		DocName string `json:"docName"`
	}
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, false
	}
	if block.DocName != "" || block.Content == "" {
		return nil, false
	}
	return map[string]any{"type": viewBlockMarkdown, "content": block.Content}, true
}

func sanitizeGalleryBlock(raw json.RawMessage) (any, bool) {
	var block struct {
		Tags    []string `json:"tags"`
		Sort    string   `json:"sort"`
		Slugs   []string `json:"slugs"`
		Limit   int      `json:"limit"`
		Columns int      `json:"columns"`
	}
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, false
	}
	out := map[string]any{
		"type":    viewBlockGallery,
		"tags":    stringsOrEmpty(block.Tags),
		"sort":    block.Sort,
		"columns": block.Columns,
	}
	if len(block.Slugs) > 0 {
		out["slugs"] = block.Slugs
	}
	if block.Limit > 0 {
		out["limit"] = block.Limit
	}
	return out, true
}

func sanitizeFeedBlock(raw json.RawMessage) (any, bool) {
	var block struct {
		Title           string   `json:"title"`
		Tags            []string `json:"tags"`
		ShowTopicFilter *bool    `json:"showTopicFilter"`
		Limit           int      `json:"limit"`
	}
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, false
	}
	showTopicFilter := true
	if block.ShowTopicFilter != nil {
		showTopicFilter = *block.ShowTopicFilter
	}
	out := map[string]any{
		"type":            viewBlockFeed,
		"title":           block.Title,
		"tags":            stringsOrEmpty(block.Tags),
		"showTopicFilter": showTopicFilter,
	}
	if block.Limit > 0 {
		out["limit"] = block.Limit
	}
	return out, true
}

// stringsOrEmpty keeps a nil slice from marshalling as null, which the reader's
// parser would then have to defend against for no reason.
func stringsOrEmpty(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// MarkdownBlockContents returns the content of every markdown block in a
// sanitized view document, in order.
//
// The publish pipeline runs over markdown, so a home page's prose has to be
// handed to it one block at a time: links to unpublished documents must be
// caught and attachment hrefs rewritten there exactly as they are in an
// ordinary page's body.
func MarkdownBlockContents(sanitized string) []string {
	var doc struct {
		Blocks []struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(sanitized), &doc); err != nil {
		return nil
	}
	contents := make([]string, 0, len(doc.Blocks))
	for _, block := range doc.Blocks {
		if block.Type == viewBlockMarkdown {
			contents = append(contents, block.Content)
		}
	}
	return contents
}

// ReplaceMarkdownBlockContents writes processed prose back into a sanitized view
// document, in the same order MarkdownBlockContents returned it.
func ReplaceMarkdownBlockContents(sanitized string, contents []string) (string, bool) {
	var doc struct {
		ViewType string           `json:"viewType"`
		Blocks   []map[string]any `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(sanitized), &doc); err != nil {
		return "", false
	}
	next := 0
	for _, block := range doc.Blocks {
		if block["type"] != viewBlockMarkdown {
			continue
		}
		if next >= len(contents) {
			return "", false
		}
		block["content"] = contents[next]
		next++
	}
	out, err := json.Marshal(map[string]any{"viewType": doc.ViewType, "blocks": doc.Blocks})
	if err != nil {
		return "", false
	}
	return string(out), true
}

