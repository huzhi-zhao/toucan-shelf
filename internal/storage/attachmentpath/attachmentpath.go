// Package attachmentpath expands the instance's attachment filepath template into a concrete
// storage path. It is shared by the upload path (which expands the template for a brand new
// attachment) and by the object migration (which re-expands the directory part of the same
// template for an attachment that already exists), so the two can never drift apart.
package attachmentpath

import (
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/usememos/memos/internal/util"
)

// UnassignedWorkspaceSlug is the directory used when an attachment has no workspace. Uploads
// that legitimately have no workspace (and any caller not yet updated) still succeed; they just
// don't get their own directory.
const UnassignedWorkspaceSlug = "_unassigned"

var placeholderPattern = regexp.MustCompile(`\{[a-z]{1,9}\}`)

// Context carries the per-attachment values that the filepath template can interpolate.
type Context struct {
	Filename string
	// WorkspaceSlug is the storage slug of the owning workspace, or "" when the caller did not
	// supply a workspace (see UnassignedWorkspaceSlug).
	WorkspaceSlug string
	// DropWorkspace expands `{workspace}` to nothing instead of a directory name. Set for local
	// storage: per-workspace directories are an S3-only concern (they exist so S3
	// lifecycle/backup rules can be scoped per knowledge base), and silently reorganizing an
	// existing local data directory is not worth it.
	DropWorkspace bool
	// At is the instant the time-based placeholders expand to. The zero value means "now",
	// which is what an upload wants; the migration passes the attachment's creation time so
	// that re-running it keeps producing the same path.
	At time.Time
}

// Expand replaces every placeholder in the template with its value.
func Expand(template string, pathCtx Context) string {
	filename := pathCtx.Filename
	workspaceSlug := pathCtx.WorkspaceSlug
	if workspaceSlug == "" {
		workspaceSlug = UnassignedWorkspaceSlug
	}
	if pathCtx.DropWorkspace {
		workspaceSlug = ""
	}
	t := pathCtx.At
	if t.IsZero() {
		t = time.Now()
	}
	expanded := placeholderPattern.ReplaceAllStringFunc(template, func(s string) string {
		switch s {
		case "{filename}":
			return filename
		case "{workspace}":
			return workspaceSlug
		case "{timestamp}":
			return fmt.Sprintf("%d", t.Unix())
		case "{year}":
			return fmt.Sprintf("%d", t.Year())
		case "{month}":
			return fmt.Sprintf("%02d", t.Month())
		case "{day}":
			return fmt.Sprintf("%02d", t.Day())
		case "{hour}":
			return fmt.Sprintf("%02d", t.Hour())
		case "{minute}":
			return fmt.Sprintf("%02d", t.Minute())
		case "{second}":
			return fmt.Sprintf("%02d", t.Second())
		case "{uuid}":
			return util.GenUUID()
		default:
			return s
		}
	})
	// A placeholder that expanded to nothing (`{workspace}` on local storage) leaves an empty
	// path segment behind; collapse it so the result stays a well-formed path. The leading
	// separator of an absolute template is preserved.
	absolute := strings.HasPrefix(expanded, "/")
	for strings.Contains(expanded, "//") {
		expanded = strings.ReplaceAll(expanded, "//", "/")
	}
	expanded = strings.TrimPrefix(expanded, "/")
	if absolute {
		expanded = "/" + expanded
	}
	return expanded
}

// Normalize returns the template with a `{filename}` segment appended when it has none, which
// is how both the upload path and the migration read a template that only names directories.
func Normalize(template string) string {
	if strings.Contains(template, "{filename}") {
		return template
	}
	return path.Join(template, "{filename}")
}

// Dir returns the directory part of a template: everything before the segment that carries
// `{filename}`. For the default template it is `assets/{workspace}`. An empty string means the
// template puts files at the root.
func Dir(template string) string {
	normalized := strings.ReplaceAll(Normalize(template), "\\", "/")
	idx := strings.LastIndex(normalized, "/")
	if idx < 0 {
		return ""
	}
	return normalized[:idx]
}

// UnstableDirPlaceholder reports the first placeholder in the template's directory part whose
// expansion is not reproducible for a given attachment. `{uuid}` is random and `{filename}`
// belongs in the last segment, so a template using either as a directory makes the migration's
// target key non-deterministic — and a non-deterministic target cannot be re-run safely.
// Returns "" when the directory part is fine.
func UnstableDirPlaceholder(template string) string {
	dir := Dir(template)
	for _, placeholder := range []string{"{uuid}", "{filename}"} {
		if strings.Contains(dir, placeholder) {
			return placeholder
		}
	}
	return ""
}
