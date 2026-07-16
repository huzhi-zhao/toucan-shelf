package memogit

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// attachmentsDir is the subfolder (under the content root) where downloaded
// attachment bytes live, grouped by attachment uid to avoid filename clashes.
const attachmentsDir = "_attachments"

// attachmentRelPath returns the repo-relative-to-content-root path for an
// attachment's local bytes: "_attachments/<uid>/<filename>".
func attachmentRelPath(attachmentName, filename string) string {
	uid := strings.TrimPrefix(attachmentName, "attachments/")
	stem := sanitizeSegment(filename)
	if stem == "" {
		stem = "file"
	}
	return filepath.Join(attachmentsDir, sanitizeSegment(uid), stem)
}

// downloadMemoAttachments downloads all of a memo's attachments into the
// content root (one-way: bytes are pulled down for local/LLM context and never
// pushed back). It skips any attachment already present locally at the same
// size, and returns the refs to record in sync-state plus the number actually
// downloaded. prev is the memo's previous attachment refs (may be nil).
func downloadMemoAttachments(ctx context.Context, client *Client, contentRoot string, m *v1pb.Memo, prev []AttachmentRef) ([]AttachmentRef, int, error) {
	atts := m.GetAttachments()
	if len(atts) == 0 {
		return nil, 0, nil
	}
	prevByName := make(map[string]AttachmentRef, len(prev))
	for _, r := range prev {
		prevByName[r.Name] = r
	}

	refs := make([]AttachmentRef, 0, len(atts))
	downloaded := 0
	for _, a := range atts {
		rel := attachmentRelPath(a.GetName(), a.GetFilename())
		ref := AttachmentRef{
			Name:     a.GetName(),
			Filename: a.GetFilename(),
			Size:     a.GetSize(),
			Path:     rel,
		}
		full := filepath.Join(contentRoot, rel)

		// Skip if we already have identical bytes locally.
		if p, ok := prevByName[a.GetName()]; ok && p.Size == a.GetSize() {
			if fi, err := os.Stat(full); err == nil && fi.Size() == a.GetSize() {
				refs = append(refs, ref)
				continue
			}
		}

		data, err := client.DownloadAttachment(ctx, a.GetName(), a.GetFilename())
		if err != nil {
			return nil, downloaded, err
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return nil, downloaded, fmt.Errorf("create attachment dir: %w", err)
		}
		if err := os.WriteFile(full, data, 0o644); err != nil {
			return nil, downloaded, fmt.Errorf("write attachment %s: %w", rel, err)
		}
		downloaded++
		refs = append(refs, ref)
	}
	return refs, downloaded, nil
}

// removeMemoAttachments deletes a memo's downloaded attachment files and their
// (now-empty) per-attachment directories. Best-effort: errors are ignored so a
// stray attachment can't block reconciliation.
func removeMemoAttachments(contentRoot string, refs []AttachmentRef) {
	for _, r := range refs {
		full := filepath.Join(contentRoot, r.Path)
		_ = os.Remove(full)
		pruneEmptyDirs(contentRoot, filepath.Dir(full))
	}
}

// pdfLocalPath returns the repo-relative-to-content-root path of a PDF
// document's primary (first) attachment once downloaded, or "" if it has none.
// Used to point the PDF stub at the real bytes on disk.
func pdfLocalPath(refs []AttachmentRef) string {
	for _, r := range refs {
		if strings.HasSuffix(strings.ToLower(r.Filename), ".pdf") {
			return r.Path
		}
	}
	if len(refs) > 0 {
		return refs[0].Path
	}
	return ""
}
