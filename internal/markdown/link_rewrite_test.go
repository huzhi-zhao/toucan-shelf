package markdown

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The rewrite functions edit links in documents the user did not touch (a move
// repairs every referencer). Anything they change beyond the link itself is
// damage to someone else's document, so these tests assert the whole output,
// not just that the link changed.

// A document shaped like the ones that got flattened in practice: a table, a
// list item with a continuation line, and the link that has to be repaired.
const rewriteFixture = "# Campaigns\n" +
	"\n" +
	"| # | Name | Note |\n" +
	"| --- | --- | --- |\n" +
	"| 1 | [Old](/Campaigns/Old.md) | first |\n" +
	"| 2 | other | second |\n" +
	"\n" +
	"- item one, see [Old](/Campaigns/Old.md)\n" +
	"  continued on a second line\n" +
	"- item two\n"

func TestRewriteLinksPreservesEverythingElse(t *testing.T) {
	svc := NewService()

	t.Run("only the destination bytes change", func(t *testing.T) {
		got, changed, err := svc.RewriteLinks([]byte(rewriteFixture), func(href, text string) (string, string, bool) {
			if href == "/Campaigns/Old.md" {
				return "/Campaigns/New.md", text, true
			}
			return href, text, false
		})
		require.NoError(t, err)
		require.True(t, changed)
		want := "# Campaigns\n" +
			"\n" +
			"| # | Name | Note |\n" +
			"| --- | --- | --- |\n" +
			"| 1 | [Old](/Campaigns/New.md) | first |\n" +
			"| 2 | other | second |\n" +
			"\n" +
			"- item one, see [Old](/Campaigns/New.md)\n" +
			"  continued on a second line\n" +
			"- item two\n"
		require.Equal(t, want, got)
	})

	t.Run("anchor text and destination change together", func(t *testing.T) {
		got, changed, err := svc.RewriteLinks([]byte(rewriteFixture), func(href, text string) (string, string, bool) {
			if href == "/Campaigns/Old.md" && text == "Old" {
				return "/Campaigns/New.md", "New", true
			}
			return href, text, false
		})
		require.NoError(t, err)
		require.True(t, changed)
		require.Contains(t, got, "| 1 | [New](/Campaigns/New.md) | first |\n")
		require.Contains(t, got, "- item one, see [New](/Campaigns/New.md)\n  continued on a second line\n")
	})

	t.Run("new anchor text with a pipe stays inside its table cell", func(t *testing.T) {
		got, _, err := svc.RewriteLinks([]byte(rewriteFixture), func(href, text string) (string, string, bool) {
			return href, "A|B", true
		})
		require.NoError(t, err)
		require.Contains(t, got, "| 1 | [A\\|B](/Campaigns/Old.md) | first |\n")
		require.Contains(t, got, "see [A|B](/Campaigns/Old.md)\n")
	})

	// Same encoding rule as the renderer's escapeDestination: a rewritten
	// destination is written percent-encoded, never in the "<...>" form.
	t.Run("angle-bracket destination is replaced by the encoded form", func(t *testing.T) {
		content := "See [Doc](</Notes/Old Doc.md>) here.\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			return "/Notes/New Doc.md", text, true
		})
		require.NoError(t, err)
		require.Equal(t, "See [Doc](/Notes/New%20Doc.md) here.\n", got)
	})

	t.Run("destination with a space is percent-encoded", func(t *testing.T) {
		content := "See [Doc](/Notes/Old.md).\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			return "/Notes/New Doc.md", text, true
		})
		require.NoError(t, err)
		require.Equal(t, "See [Doc](/Notes/New%20Doc.md).\n", got)
	})

	t.Run("link title survives", func(t *testing.T) {
		content := "See [Doc](/Notes/Old.md \"hover\").\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			return "/Notes/New.md", text, true
		})
		require.NoError(t, err)
		require.Equal(t, "See [Doc](/Notes/New.md \"hover\").\n", got)
	})

	t.Run("label containing code and brackets", func(t *testing.T) {
		content := "See [the `a]b` [x] doc](/Notes/Old.md).\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			return "/Notes/New.md", text, true
		})
		require.NoError(t, err)
		require.Equal(t, "See [the `a]b` [x] doc](/Notes/New.md).\n", got)
	})

	t.Run("reference link becomes inline, definition untouched for other users", func(t *testing.T) {
		content := "See [Doc][d] and [again][d].\n\n[d]: /Notes/Old.md\n"
		calls := 0
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			calls++
			if text == "Doc" {
				return "/Notes/New.md", text, true
			}
			return href, text, false
		})
		require.NoError(t, err)
		require.Equal(t, 2, calls)
		require.Equal(t, "See [Doc](/Notes/New.md) and [again][d].\n\n[d]: /Notes/Old.md\n", got)
	})

	t.Run("collapsed and shortcut reference links", func(t *testing.T) {
		content := "A [Doc][] and [Doc].\n\n[Doc]: /Notes/Old.md\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			return "/Notes/New.md", text, true
		})
		require.NoError(t, err)
		require.Equal(t, "A [Doc](/Notes/New.md) and [Doc](/Notes/New.md).\n\n[Doc]: /Notes/Old.md\n", got)
	})

	t.Run("several links on one line", func(t *testing.T) {
		content := "[a](/x.md) [b](/y.md) [c](/x.md)\n"
		got, _, err := svc.RewriteLinks([]byte(content), func(href, text string) (string, string, bool) {
			if href == "/x.md" {
				return "/z/long/path.md", text, true
			}
			return href, text, false
		})
		require.NoError(t, err)
		require.Equal(t, "[a](/z/long/path.md) [b](/y.md) [c](/z/long/path.md)\n", got)
	})
}

func TestRewriteLinkAnchorsPreservesEverythingElse(t *testing.T) {
	svc := NewService()
	got, changed, err := svc.RewriteLinkAnchors([]byte(rewriteFixture), func(href, text string) (string, bool) {
		if text == "Old" {
			return "New", true
		}
		return "", false
	})
	require.NoError(t, err)
	require.True(t, changed)
	want := "# Campaigns\n" +
		"\n" +
		"| # | Name | Note |\n" +
		"| --- | --- | --- |\n" +
		"| 1 | [New](/Campaigns/Old.md) | first |\n" +
		"| 2 | other | second |\n" +
		"\n" +
		"- item one, see [New](/Campaigns/Old.md)\n" +
		"  continued on a second line\n" +
		"- item two\n"
	require.Equal(t, want, got)
}

func TestRewriteMediaSourcesPreservesEverythingElse(t *testing.T) {
	svc := NewService()
	content := "| a | b |\n| --- | --- |\n| ![x](/file/1.png) | y |\n\n- ![alt](/file/1.png \"t\")\n  more\n"
	got, changed, err := svc.RewriteMediaSources([]byte(content), func(src string) (string, bool) {
		return "/site/1.png", true
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, "| a | b |\n| --- | --- |\n| ![x](/site/1.png) | y |\n\n- ![alt](/site/1.png \"t\")\n  more\n", got)
}
