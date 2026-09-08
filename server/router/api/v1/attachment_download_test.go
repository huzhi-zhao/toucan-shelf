package v1

import (
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// What a caller passes is usually pasted by a person, not composed by a program.
// Every shape the app or a document can put on someone's clipboard has to land on
// the same attachment.
func TestResolveAttachmentReference(t *testing.T) {
	const uid = "aB3-x_9"

	for name, input := range map[string]string{
		"resource name":       "attachments/" + uid,
		"bare uid":            uid,
		"site-relative path":  "/file/attachments/" + uid + "/report.pdf",
		"absolute url":        "https://kb.example.com/file/attachments/" + uid + "/report.pdf",
		"markdown reference":  "![report.pdf](/file/attachments/" + uid + "/report.pdf)",
		"percent-encoded":     "/file/attachments/" + uid + "/%E6%8A%A5%E5%91%8A.pdf",
		"url with query":      "/file/attachments/" + uid + "/report.pdf?thumbnail=true",
		"surrounded by space": "  attachments/" + uid + "  ",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := resolveAttachmentReference(input)
			require.NoError(t, err)
			require.Equal(t, uid, got)
		})
	}
}

// A reference nothing can be made of must be refused, not guessed at: resolving
// it to the wrong attachment would hand back a URL for someone else's file.
func TestResolveAttachmentReferenceRejectsUnusableInput(t *testing.T) {
	for name, input := range map[string]string{
		"empty":         "",
		"blank":         "   ",
		"prose":         "the report attached to that page",
		"other route":   "/api/v1/memos/abc123",
		"wrong plural":  "attachment/abc123",
		"memo resource": "memos/abc123",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := resolveAttachmentReference(input)
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}
}

// The whitelist is about what an agent can actually open once it has the bytes.
// Getting it wrong in either direction is a real cost: a missing type sends the
// user to do it by hand for no reason, an extra one ends in "I downloaded it and
// cannot read it".
func TestDownloadableTypes(t *testing.T) {
	for _, mimeType := range []string{
		"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
	} {
		require.True(t, downloadableTypes[mimeType], "%s should be downloadable", mimeType)
	}
	// Office documents arrive as binary zip containers, HEIC cannot be decoded,
	// and media is neither readable nor small.
	for _, mimeType := range []string{
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/msword",
		"application/epub+zip",
		"application/zip",
		"image/heic",
		"video/mp4",
		"audio/mpeg",
	} {
		require.False(t, downloadableTypes[mimeType], "%s should not be downloadable", mimeType)
	}
}
