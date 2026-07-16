package memogit

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// HashContent returns "sha256:<hex>" for the given bytes.
func HashContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// CanonicalHash hashes content in a canonical form so a memo's server content
// and its on-disk file compare equal despite trailing-newline normalization
// (writeFile trims trailing newlines and appends exactly one). This is the
// hash stored in sync-state and compared on pull/push.
func CanonicalHash(content string) string {
	return HashContent(strings.TrimRight(content, "\n"))
}

// uidFromName extracts the uid from a memo resource name ("memos/{uid}").
func uidFromName(name string) string {
	return strings.TrimPrefix(name, "memos/")
}

func tsToTime(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime().UTC()
}

// docTypeString normalizes a memo's doc type to one of MARKDOWN/HTML/PDF/VIEW,
// defaulting unknown/unspecified to MARKDOWN.
func docTypeString(m *v1pb.Memo) string {
	switch m.GetDocType() {
	case v1pb.Memo_HTML:
		return "HTML"
	case v1pb.Memo_PDF:
		return "PDF"
	case v1pb.Memo_VIEW:
		return "VIEW"
	default:
		return "MARKDOWN"
	}
}

// docTypeFromString converts a MARKDOWN/HTML/PDF/VIEW string back to the proto
// enum for push (CreateMemo). Unknown values default to MARKDOWN.
func docTypeFromString(s string) v1pb.Memo_DocType {
	switch s {
	case "HTML":
		return v1pb.Memo_HTML
	case "PDF":
		return v1pb.Memo_PDF
	case "VIEW":
		return v1pb.Memo_VIEW
	default:
		return v1pb.Memo_MARKDOWN
	}
}

// docTypeFromExt derives a doc type from a repo-relative file path's extension,
// inverting extForDocType. Order matters: the compound extensions (.pdf.md,
// .view.json) must be checked before the plain ones.
func docTypeFromExt(relPath string) string {
	switch {
	case strings.HasSuffix(relPath, ".pdf.md"):
		return "PDF"
	case strings.HasSuffix(relPath, ".view.json"):
		return "VIEW"
	case strings.HasSuffix(relPath, ".html"):
		return "HTML"
	default:
		return "MARKDOWN"
	}
}

// stripDocExt removes the doc-type extension from a filename, returning the
// title stem. Mirrors docTypeFromExt / extForDocType.
func stripDocExt(name string) string {
	for _, ext := range []string{".pdf.md", ".view.json", ".html", ".md"} {
		if strings.HasSuffix(name, ext) {
			return strings.TrimSuffix(name, ext)
		}
	}
	return name
}

// relationUIDs extracts the related memo uids for read-only export into
// sync-state (v1 does not sync relations back).
func relationUIDs(m *v1pb.Memo) []string {
	var out []string
	for _, r := range m.GetRelations() {
		if related := r.GetRelatedMemo().GetName(); related != "" {
			out = append(out, uidFromName(related))
		}
	}
	return out
}

// FileContent renders the local file bytes for a memo. Under the sidecar model
// the file holds the memo's content verbatim (no memogit frontmatter), except
// PDF documents which carry no editable body — for those we write a small
// human-/AI-readable reference stub pointing at the downloaded attachment bytes.
// refs are the memo's downloaded attachments (may be nil).
func FileContent(m *v1pb.Memo, refs []AttachmentRef) string {
	if docTypeString(m) == "PDF" {
		return pdfPlaceholder(m, refs)
	}
	return m.GetContent()
}

// pdfPlaceholder builds the stub body for a PDF document (no editable content),
// pointing at the local downloaded bytes so an LLM/reader can open them.
func pdfPlaceholder(m *v1pb.Memo, refs []AttachmentRef) string {
	var b strings.Builder
	b.WriteString("<!-- memogit: PDF document (render-only, no editable body). ")
	b.WriteString("Edits here are not synced; the real bytes are the attachment(s) below. -->\n\n")
	fmt.Fprintf(&b, "# %s\n\n", m.GetTitle())
	atts := m.GetAttachments()
	if len(atts) == 0 {
		b.WriteString("_(no attachment referenced)_\n")
		return b.String()
	}
	if local := pdfLocalPath(refs); local != "" {
		fmt.Fprintf(&b, "Local file: [`%s`](%s)\n\n", local, local)
	}
	b.WriteString("Attachments:\n")
	for _, a := range atts {
		fmt.Fprintf(&b, "- %s (%s, resource: %s)\n", a.GetFilename(), a.GetType(), a.GetName())
	}
	return b.String()
}
