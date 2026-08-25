package publish

import "strings"

// SplitFrontmatter splits a leading YAML frontmatter block off content and
// returns the block's inner text and the body that follows it. Content without a
// frontmatter block comes back unchanged with an empty first return value.
//
// The rules mirror the editor's parser (web/src/utils/frontmatter.ts): the block
// must open on the very first line with `---` and close on a line of its own.
// Frontmatter carries the knowledge base's own semantics — status, ordering,
// memogit identity — none of which is on the list of what may leave it, so the
// publish pipeline reads what it needs here and drops the rest.
func SplitFrontmatter(content string) (frontmatter, body string) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], " \t") != "---" {
		return "", content
	}
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], " \t") != "---" {
			continue
		}
		return strings.Join(lines[1:i], "\n"), strings.Join(lines[i+1:], "\n")
	}
	// No closing fence: the document has no frontmatter, only a first line that
	// looked like the start of one.
	return "", content
}

// FrontmatterValue returns the value of a flat scalar key, or "" when the key is
// absent or holds anything that is not a scalar (a list, a nested map). Only the
// keys the pipeline explicitly asks for are ever read.
func FrontmatterValue(frontmatter, key string) string {
	for _, line := range strings.Split(frontmatter, "\n") {
		// Indented lines belong to a nested structure, which this deliberately
		// does not understand.
		if line != strings.TrimLeft(line, " \t") {
			continue
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(name) != key {
			continue
		}
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, "[") || value == "" {
			return ""
		}
		return strings.Trim(value, `"'`)
	}
	return ""
}

// FrontmatterList returns the items of a flat list-valued key, in document
// order, with empties dropped. Both YAML shapes the editor writes are read:
//
//	tags: [guide, release]
//	tags:
//	  - guide
//	  - release
//
// A key that is absent, holds a scalar, or opens a nested map returns nil —
// the same "don't guess" rule the scalar reader follows. The parsing mirrors
// web/src/utils/frontmatter.ts so a document classified as a list in the
// properties panel is the same list here.
func FrontmatterList(frontmatter, key string) []string {
	lines := strings.Split(frontmatter, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		// Indented lines belong to the block above them, not to a key of their own.
		if line != strings.TrimLeft(line, " \t") {
			continue
		}
		name, rest, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(name) != key {
			continue
		}
		rest = strings.TrimSpace(rest)
		if strings.HasPrefix(rest, "[") && strings.HasSuffix(rest, "]") {
			return splitFlowList(rest[1 : len(rest)-1])
		}
		if rest != "" {
			// A scalar. Not a list, and the first occurrence of a key wins, so
			// there is nothing further to look for.
			return nil
		}
		return blockList(lines[i+1:])
	}
	return nil
}

// blockList reads the `- item` entries indented under a key. It stops at the
// first line that is neither blank nor indented (the next key), and gives up
// entirely on an indented line that is not an entry — that is a nested map,
// which this deliberately does not understand.
func blockList(lines []string) []string {
	items := []string{}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if line == strings.TrimLeft(line, " \t") {
			break
		}
		entry := strings.TrimLeft(line, " \t")
		if !strings.HasPrefix(entry, "-") {
			return nil
		}
		if item := unquoteScalar(strings.TrimSpace(entry[1:])); item != "" {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func splitFlowList(inner string) []string {
	items := []string{}
	for _, raw := range strings.Split(inner, ",") {
		if item := unquoteScalar(strings.TrimSpace(raw)); item != "" {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func unquoteScalar(raw string) string {
	if len(raw) >= 2 && (raw[0] == '"' && raw[len(raw)-1] == '"' || raw[0] == '\'' && raw[len(raw)-1] == '\'') {
		return raw[1 : len(raw)-1]
	}
	return raw
}
