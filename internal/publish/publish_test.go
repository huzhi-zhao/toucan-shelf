package publish

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeSlug(t *testing.T) {
	require.Equal(t, "hello-world", NormalizeSlug("Hello World"))
	require.Equal(t, "hello-world", NormalizeSlug("  Hello   World  "))
	require.Equal(t, "api-v2-notes", NormalizeSlug("API v2 — notes!"))
	require.Equal(t, "", NormalizeSlug("对外发布"))
	require.Equal(t, "2026", NormalizeSlug("《2026》"))
}

func TestGenerateSlugFallsBackToDocUID(t *testing.T) {
	free := func(string) bool { return false }
	// A CJK-only title with no translation available must still publish.
	require.Equal(t, "d-abcdefgh", GenerateSlug("", "对外发布", "abcdefghijkl", free))
	// A translated base wins over the raw title.
	require.Equal(t, "public-publishing", GenerateSlug("Public Publishing", "对外发布", "abcdefghijkl", free))
}

func TestGenerateSlugDisambiguatesCollisions(t *testing.T) {
	taken := map[string]bool{"notes": true, "notes-2": true}
	got := GenerateSlug("Notes", "Notes", "abcdefghijkl", func(s string) bool { return taken[s] })
	require.Equal(t, "notes-3", got)
}

func TestGenerateSlugAvoidsReservedPaths(t *testing.T) {
	// A document titled "Search" must not take the site's own search page.
	got := GenerateSlug("Search", "Search", "abcdefghijkl", func(string) bool { return false })
	require.Equal(t, "d-abcdefgh", got)
}

func TestValidateSlugRejectsReservedAndMalformed(t *testing.T) {
	require.NoError(t, ValidateSlug("my-post"))
	require.ErrorIs(t, ValidateSlug(""), ErrSlugEmpty)
	require.ErrorIs(t, ValidateSlug("search"), ErrSlugReserved)
	require.ErrorIs(t, ValidateSlug("My Post"), ErrSlugInvalidChars)
	require.ErrorIs(t, ValidateSlug("中文"), ErrSlugInvalidChars)
}

func TestStripSecretBlocks(t *testing.T) {
	content := "# Title\n\n```toucan-secret\nv: 1\nid: abc\nhint: prod db\n```\n\nafter\n"
	got, removed := StripSecretBlocks(content)
	require.Equal(t, 1, removed)
	require.NotContains(t, got, "toucan-secret")
	require.NotContains(t, got, "abc")
	require.Contains(t, got, "# Title")
	require.Contains(t, got, "after")
}

func TestStripSecretBlocksLeavesOtherFencesByteForByte(t *testing.T) {
	content := "```go\nfmt.Println(\"toucan-secret\")\n```\n"
	got, removed := StripSecretBlocks(content)
	require.Equal(t, 0, removed)
	require.Equal(t, content, got)
}

func TestStripSecretBlocksHandlesLongerFences(t *testing.T) {
	content := "````toucan-secret\nv: 1\nid: abc\n```\nstill inside\n````\ntail\n"
	got, removed := StripSecretBlocks(content)
	require.Equal(t, 1, removed)
	require.NotContains(t, got, "still inside")
	require.Contains(t, got, "tail")
}

func TestParseAttachmentUID(t *testing.T) {
	uid, ok := ParseAttachmentUID("/file/attachments/abc123/photo.png")
	require.True(t, ok)
	require.Equal(t, "abc123", uid)

	uid, ok = ParseAttachmentUID("https://notes.example.com/file/attachments/abc123/photo.png")
	require.True(t, ok)
	require.Equal(t, "abc123", uid)

	_, ok = ParseAttachmentUID("/doc/other.md")
	require.False(t, ok)
}

func TestSiteAttachmentHrefDropsMainAppOrigin(t *testing.T) {
	got, ok := SiteAttachmentHref("https://notes.example.com/file/attachments/abc123/photo.png")
	require.True(t, ok)
	require.Equal(t, "/file/attachments/abc123/photo.png", got)
}
