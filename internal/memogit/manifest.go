package memogit

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// Local attachment manifest.
//
// A document's attachment bytes are downloaded to _attachments/<uid>/<filename>
// (see attachments.go), but nothing in the document itself used to point at
// them: an agent reading the file had no way to learn the document had
// attachments at all, let alone where they landed. The bytes sat on disk unread
// — the feature was, in practice, absent.
//
// The manifest closes that gap by listing them in a trailing HTML comment,
// invisible in a rendered preview but plainly readable to an agent and to grep.
// Like the identity marker it sits next to, it is strictly local: StripLocalID
// removes it, and every path that hashes or uploads a work-tree file goes
// through StripLocalID, so it can never reach the server. See
// docs/dev/requirements/collaboration/agent-attachment-reading.md §2.
//
// Entries are split into inline and mounted because the two need different
// judgement from a reader. An inline attachment is referenced from the body, so
// its alt text and surrounding prose already say what it is; the manifest only
// has to map that reference to a local path. A mounted attachment appears
// nowhere in the body — its filename is the only signal there is, which is why
// the operating rules for deciding whether to open one live in
// docs/skill/references/attachments.md rather than here.
const manifestKey = "memogit-attachments"

// manifestRe matches a whole manifest block. The closing "-->" must be on a
// line of its own, and the body match is non-greedy, so a malformed block (no
// closing line) matches nothing at all rather than swallowing the document.
var manifestRe = regexp.MustCompile(`(?ms)^[ \t]*<!--[ \t]*` + manifestKey + `:.*?\n[ \t]*-->[ \t]*$`)

// renderManifest builds the manifest block for a memo, or "" when there is
// nothing to list. refs are the attachments whose bytes were actually
// downloaded; one that failed to download is left out, because the block's
// whole purpose is to point at local bytes and there are none to point at. The
// next pull retries it and the block picks it up then.
func renderManifest(m *v1pb.Memo, refs []AttachmentRef) string {
	if len(refs) == 0 {
		return ""
	}
	typeByName := make(map[string]string, len(m.GetAttachments()))
	for _, a := range m.GetAttachments() {
		typeByName[a.GetName()] = a.GetType()
	}

	body := m.GetContent()
	var inline, mounted []string
	for _, r := range refs {
		entry := manifestEntry(r, typeByName[r.Name])
		if referencesAttachment(body, r.Name) {
			inline = append(inline, entry)
		} else {
			mounted = append(mounted, entry)
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "<!-- %s: read-only, never edited or uploaded.\n", manifestKey)
	b.WriteString("Paths are relative to the workspace content root, not to this file.\n")
	writeManifestSection(&b, "inline", inline)
	writeManifestSection(&b, "mounted", mounted)
	b.WriteString("-->")
	return b.String()
}

func writeManifestSection(b *strings.Builder, label string, entries []string) {
	if len(entries) == 0 {
		return
	}
	fmt.Fprintf(b, "%s:\n", label)
	for _, e := range entries {
		fmt.Fprintf(b, "- %s\n", e)
	}
}

// manifestEntry renders one line: filename, MIME type, human-readable size, and
// the local path. The size is there so a reader can weigh the cost of opening
// the file before it does — a 12 MB scan and an 8 KB csv are not the same
// decision.
func manifestEntry(r AttachmentRef, mimeType string) string {
	if mimeType == "" {
		mimeType = "unknown"
	}
	return fmt.Sprintf("%s (%s, %s) -> %s",
		manifestSafe(r.Filename), manifestSafe(mimeType), humanSize(r.Size),
		filepath.ToSlash(r.Path))
}

// referencesAttachment reports whether a memo's body links to the attachment,
// which is what makes it "inline" rather than merely mounted.
//
// The test is a substring search for the attachment's file route rather than a
// read of the proto's AttachmentOrigin field: that field is only set when the
// uploading client supplies it, so attachments created before it existed report
// ATTACHMENT_ORIGIN_UNSPECIFIED and would be misfiled. The route prefix stops
// before the filename, so percent-encoding of the filename cannot break the
// match, and a fully-qualified URL matches just as well as a site-relative one.
func referencesAttachment(body, attachmentName string) bool {
	return strings.Contains(body, "/file/"+attachmentName+"/")
}

// manifestSafe keeps server-supplied text from breaking the block. A filename
// carrying a newline or a "-->" would produce a manifest that manifestRe cannot
// match, and an unstrippable marker means a phantom conflict on every
// subsequent sync — so this is a correctness guard, not cosmetics.
func manifestSafe(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		return r
	}, s)
	return strings.ReplaceAll(s, "-->", "--&gt;")
}

// humanSize renders a byte count the way a reader weighing "is this worth
// opening" wants to see it, using binary units.
func humanSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	value := float64(n)
	units := []string{"KB", "MB", "GB", "TB"}
	i := -1
	for value >= unit && i < len(units)-1 {
		value /= unit
		i++
	}
	if value >= 100 {
		return fmt.Sprintf("%.0f %s", value, units[i])
	}
	return fmt.Sprintf("%.1f %s", value, units[i])
}

// extractManifest returns the manifest block already present in a file, or ""
// when it carries none. It lets InjectLocalID re-stamp a file's identity
// without destroying a manifest it has no way to rebuild — ensureLocalIDs works
// from a file on disk and never sees the server's attachment list.
func extractManifest(content string) string {
	return manifestRe.FindString(content)
}

// stripManifest removes the manifest block. Callers rely on this being the
// exact inverse of the assembly done by injectMarkers.
func stripManifest(content string) string {
	return manifestRe.ReplaceAllString(content, "")
}
