package markdown

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractLinks(t *testing.T) {
	svc := NewService()

	t.Run("finds links in document order", func(t *testing.T) {
		content := []byte("See [Alpha](/memos/a1) and [Beta](notes/beta.md) for details.")
		links, err := svc.ExtractLinks(content)
		require.NoError(t, err)
		require.Len(t, links, 2)
		require.Equal(t, LinkRef{Href: "/memos/a1", Text: "Alpha"}, links[0])
		require.Equal(t, LinkRef{Href: "notes/beta.md", Text: "Beta"}, links[1])
	})

	t.Run("ignores links inside fenced code blocks", func(t *testing.T) {
		content := []byte("```\n[Alpha](/memos/a1)\n```\n")
		links, err := svc.ExtractLinks(content)
		require.NoError(t, err)
		require.Empty(t, links)
	})

	t.Run("ignores links inside inline code spans", func(t *testing.T) {
		content := []byte("Use `[Alpha](/memos/a1)` literally, not [Beta](/memos/b1) as a link.")
		links, err := svc.ExtractLinks(content)
		require.NoError(t, err)
		require.Len(t, links, 1)
		require.Equal(t, "/memos/b1", links[0].Href)
	})

	t.Run("no links returns an empty result", func(t *testing.T) {
		links, err := svc.ExtractLinks([]byte("plain text, no links here"))
		require.NoError(t, err)
		require.Empty(t, links)
	})
}

func TestRewriteLinkAnchors(t *testing.T) {
	svc := NewService()

	t.Run("rewrites only the matching link's anchor text", func(t *testing.T) {
		content := []byte("See [Old Title](/memos/a1) and [Other](/memos/b1).")
		newContent, changed, err := svc.RewriteLinkAnchors(content, func(href, text string) (string, bool) {
			if href == "/memos/a1" && text == "Old Title" {
				return "New Title", true
			}
			return "", false
		})
		require.NoError(t, err)
		require.True(t, changed)
		require.Contains(t, newContent, "[New Title](/memos/a1)")
		require.Contains(t, newContent, "[Other](/memos/b1)")
	})

	t.Run("leaves content byte-for-byte unchanged when nothing matches", func(t *testing.T) {
		content := []byte("See [Custom Label](/memos/a1) for details.")
		newContent, changed, err := svc.RewriteLinkAnchors(content, func(href, text string) (string, bool) {
			// Anchor text doesn't equal the old title, so decide must say no —
			// this mirrors the P2 rule that hand-edited anchors are never touched.
			if text == "Old Title" {
				return "New Title", true
			}
			return "", false
		})
		require.NoError(t, err)
		require.False(t, changed)
		require.Equal(t, string(content), newContent)
	})

	t.Run("does not rewrite a target uid mentioned in a code span", func(t *testing.T) {
		content := []byte("Reference `/memos/a1` in prose and [Old Title](/memos/a1) as a link.")
		newContent, changed, err := svc.RewriteLinkAnchors(content, func(href, text string) (string, bool) {
			if href == "/memos/a1" && text == "Old Title" {
				return "New Title", true
			}
			return "", false
		})
		require.NoError(t, err)
		require.True(t, changed)
		require.Contains(t, newContent, "`/memos/a1`")
		require.Contains(t, newContent, "[New Title](/memos/a1)")
	})

	t.Run("repeated calls are idempotent", func(t *testing.T) {
		content := []byte("See [Old Title](/memos/a1).")
		decide := func(href, text string) (string, bool) {
			if href == "/memos/a1" && text == "Old Title" {
				return "New Title", true
			}
			return "", false
		}
		once, changed, err := svc.RewriteLinkAnchors(content, decide)
		require.NoError(t, err)
		require.True(t, changed)

		twice, changed, err := svc.RewriteLinkAnchors([]byte(once), decide)
		require.NoError(t, err)
		require.False(t, changed)
		require.Equal(t, once, twice)
	})
}
