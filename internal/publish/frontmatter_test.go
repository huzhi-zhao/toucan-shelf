package publish

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSplitFrontmatter(t *testing.T) {
	fm, body := SplitFrontmatter("---\ncover: attachments/abc\n---\nbody\n")
	require.Equal(t, "cover: attachments/abc", fm)
	require.Equal(t, "body\n", body)

	// A document with no frontmatter comes back untouched, and so does one whose
	// opening fence is never closed — a body that happens to start with a rule
	// must not be eaten.
	for _, content := range []string{"body only", "---\nnot closed\nbody", "text\n---\ncover: x\n---\n"} {
		fm, body := SplitFrontmatter(content)
		require.Empty(t, fm)
		require.Equal(t, content, body)
	}

	fm, body = SplitFrontmatter("---\r\ncover: x\r\n---\r\nbody")
	require.Equal(t, "cover: x", fm)
	require.Equal(t, "body", body)
}

func TestFrontmatterValue(t *testing.T) {
	fm := "title: \"Quoted\"\ncover: attachments/abc\ntags: [a, b]\nempty:\nnested:\n  key: value"
	require.Equal(t, "attachments/abc", FrontmatterValue(fm, "cover"))
	require.Equal(t, "Quoted", FrontmatterValue(fm, "title"))
	// Anything that is not a flat scalar reads as absent rather than as a
	// guess at what the author meant.
	require.Empty(t, FrontmatterValue(fm, "tags"))
	require.Empty(t, FrontmatterValue(fm, "empty"))
	require.Empty(t, FrontmatterValue(fm, "key"))
	require.Empty(t, FrontmatterValue(fm, "missing"))
}

func TestFrontmatterList(t *testing.T) {
	// Both shapes the editor writes read as the same list.
	require.Equal(t, []string{"guide", "release"}, FrontmatterList("tags: [guide, release]", "tags"))
	require.Equal(t, []string{"guide", "release"}, FrontmatterList("tags:\n  - guide\n  - release\nnext: x", "tags"))
	// Quoting is incidental; a tag is its text either way.
	require.Equal(t, []string{"a b", "c"}, FrontmatterList(`tags: ["a b", 'c']`, "tags"))
	// A single item is still a list, and blanks inside the block are skipped.
	require.Equal(t, []string{"one"}, FrontmatterList("tags:\n\n  - one\n", "tags"))

	// Everything that is not a flat list reads as absent rather than as a guess.
	require.Nil(t, FrontmatterList("tags: guide", "tags"))
	require.Nil(t, FrontmatterList("tags: []", "tags"))
	require.Nil(t, FrontmatterList("tags:\n  a: 1\n", "tags"))
	require.Nil(t, FrontmatterList("tags:\n", "tags"))
	require.Nil(t, FrontmatterList("title: x", "tags"))
	// The next key ends the block: `other`'s entries are not this key's.
	require.Equal(t, []string{"one"}, FrontmatterList("tags:\n  - one\nother:\n  - two\n", "tags"))
}
