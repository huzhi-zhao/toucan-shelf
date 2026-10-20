package memogit

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Adding attachments, and only adding.
//
// `memogit attach` is the one way bytes ever travel from the checkout to the
// server's attachment store. It never runs from push — dropping a file into
// _attachments/ still syncs nothing — so a local delete or edit can never be
// read as a request to change what the server holds. Without --confirm it is a
// dry run that prints the upload plan and fails, so an agent has a concrete list
// to show the user and ask about before anything leaves the machine. See
// docs/dev/requirements/collaboration/agent-attachment-upload.md.

const (
	// maxMediaUploadBytes and maxAPIRequestBytes mirror the server's hard caps
	// (server/router/api/v1): they hold whatever the instance setting says, so
	// they can be checked locally even when that setting is admin-only.
	maxMediaUploadBytes = 100 << 20
	maxAPIRequestBytes  = 256 << 20
)

// ErrAttachNotConfirmed is returned by a dry run: the plan was printed but
// nothing was uploaded, because uploading needs the user's go-ahead.
var ErrAttachNotConfirmed = errors.New("preview only, nothing uploaded — show this list to the user, and once they agree re-run with --confirm")

// AttachResult reports what an attach run did.
type AttachResult struct {
	// Doc is the document's path relative to its knowledge base.
	Doc string
	// Uploaded and NotUploaded are filenames; NotUploaded is non-empty only when
	// an upload failed partway, and lists the failed file and everything after it.
	Uploaded    []string
	NotUploaded []string
}

// attachUpload is one local file checked and read, ready to send.
type attachUpload struct {
	source   string
	filename string
	mimeType string
	data     []byte
}

// Attach appends local files to a document as mounted attachments. docPath and
// files are paths as the user typed them (relative to the current directory or
// absolute). It is all-or-nothing up to the first upload: any file failing a
// check rejects the whole run. Once uploads start, a failure stops the run but
// keeps what already went up — rolling it back would be a deletion.
func Attach(ctx context.Context, root string, cfg *Config, docPath string, files []string, confirm bool, out io.Writer) (*AttachResult, error) {
	if len(files) == 0 {
		return nil, fmt.Errorf("no files to attach")
	}
	ws, rel, err := locateDoc(root, cfg, docPath)
	if err != nil {
		return nil, err
	}
	state, err := LoadState(root, ws.stateName())
	if err != nil {
		return nil, err
	}
	uid := state.PathIndex()[rel]
	if uid == "" {
		return nil, fmt.Errorf("%s is not a document on the server at this path (new, moved or renamed locally?) — run `memogit push` first", rel)
	}
	prev := state.Memos[uid]
	if prev.DocType == "PDF" {
		return nil, fmt.Errorf("%s is a PDF document: its first attachment is the document itself, so memogit does not add attachments to it — use the app (%s)", rel, appLink(cfg, uid))
	}

	client := NewClient(cfg)
	memo, err := client.GetMemo(ctx, uid)
	if err != nil {
		return nil, err
	}
	existing := make(map[string]bool, len(memo.GetAttachments()))
	var existingNames []string
	for _, a := range memo.GetAttachments() {
		existing[a.GetFilename()] = true
		existingNames = append(existingNames, a.GetFilename())
	}

	limit := client.UploadSizeLimit(ctx)
	uploads := make([]attachUpload, 0, len(files))
	seen := make(map[string]string, len(files))
	for _, f := range files {
		up, err := readUpload(f, limit)
		if err != nil {
			return nil, err
		}
		if other, dup := seen[up.filename]; dup {
			return nil, fmt.Errorf("%s and %s would both be attached as %q; attach one per name", other, f, up.filename)
		}
		seen[up.filename] = f
		if existing[up.filename] {
			return nil, fmt.Errorf("%s already has an attachment named %q. Replacing one is an edit, which memogit leaves to the app (%s); rename the file to add it alongside", rel, up.filename, appLink(cfg, uid))
		}
		uploads = append(uploads, up)
	}

	printAttachPlan(out, rel, uid, uploads, existingNames)
	if !confirm {
		return nil, ErrAttachNotConfirmed
	}

	res := &AttachResult{Doc: rel}
	var uploadErr error
	for i, up := range uploads {
		if _, err := client.AddMemoAttachment(ctx, memo.GetName(), up.filename, up.mimeType, up.data); err != nil {
			uploadErr = err
			for _, rest := range uploads[i:] {
				res.NotUploaded = append(res.NotUploaded, rest.filename)
			}
			break
		}
		res.Uploaded = append(res.Uploaded, up.filename)
		fmt.Fprintf(out, "  ✓ %s\n", up.filename)
	}

	if len(res.Uploaded) > 0 {
		if err := syncAttachedDoc(ctx, client, root, ws, state, uid, out); err != nil {
			return res, fmt.Errorf("uploaded %d attachment(s), but updating the local copy failed (the next pull retries it): %w", len(res.Uploaded), err)
		}
		if err := GitCommitAll(root, fmt.Sprintf("memogit attach %s: %d attachment(s)", rel, len(res.Uploaded))); err != nil {
			return res, err
		}
	}
	if uploadErr != nil {
		return res, fmt.Errorf("%w\nuploaded: %s\nnot uploaded: %s\nnothing was rolled back; to remove an uploaded attachment, use the app (%s)",
			uploadErr, listOrNone(res.Uploaded), listOrNone(res.NotUploaded), appLink(cfg, uid))
	}
	fmt.Fprintf(out, "Attached %d file(s) to %s.\n", len(res.Uploaded), rel)
	return res, nil
}

// locateDoc maps a document path typed on the command line to the knowledge
// base that holds it and its path within that knowledge base's content root.
func locateDoc(root string, cfg *Config, docPath string) (*WorkspaceConfig, string, error) {
	abs, err := filepath.Abs(docPath)
	if err != nil {
		return nil, "", err
	}
	// Resolve symlinks on both sides (macOS's /tmp → /private/tmp) so the
	// containment check compares like with like.
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	var best *WorkspaceConfig
	bestRel, bestLen := "", -1
	for _, ws := range cfg.Workspaces {
		contentRoot := ContentRoot(root, ws)
		rel, err := filepath.Rel(contentRoot, abs)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if len(contentRoot) > bestLen {
			best, bestRel, bestLen = ws, rel, len(contentRoot)
		}
	}
	if best == nil {
		return nil, "", fmt.Errorf("%s is not inside any knowledge base checked out here", docPath)
	}
	if _, err := os.Stat(abs); err != nil {
		return nil, "", fmt.Errorf("document %s: %w", docPath, err)
	}
	return best, bestRel, nil
}

// readUpload checks one local file against everything that can be checked
// before sending it, and reads it. limit is the instance's upload limit in
// bytes, or 0 when unknown.
func readUpload(path string, limit int64) (attachUpload, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		return attachUpload{}, err
	}
	if !fi.Mode().IsRegular() {
		return attachUpload{}, fmt.Errorf("%s is not a regular file (directories and symlinks are not attached)", path)
	}
	name := filepath.Base(path)
	if !validAttachmentFilename(name) {
		return attachUpload{}, fmt.Errorf("%s: the server rejects filenames that start or end with a space or a dot; rename it first", path)
	}
	size := fi.Size()
	if size > maxAPIRequestBytes || (limit > 0 && size > limit) {
		return attachUpload{}, fmt.Errorf("%s is %s, over the upload limit", path, humanSize(size))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return attachUpload{}, err
	}
	mimeType := detectMimeType(name, data)
	if isMediaType(mimeType) && size > maxMediaUploadBytes {
		return attachUpload{}, fmt.Errorf("%s is %s; audio, video and images are limited to 100 MB", path, humanSize(size))
	}
	return attachUpload{source: path, filename: name, mimeType: mimeType, data: data}, nil
}

// validAttachmentFilename mirrors the server's validateFilename for a name that
// is already a single path element.
func validAttachmentFilename(name string) bool {
	return name != "" && !strings.HasPrefix(name, " ") && !strings.HasSuffix(name, " ") &&
		!strings.HasPrefix(name, ".") && !strings.HasSuffix(name, ".")
}

// detectMimeType guesses a type the way the server would when given none, so
// the plan shows what the attachment will be recorded as.
func detectMimeType(name string, data []byte) string {
	t := mime.TypeByExtension(filepath.Ext(name))
	if t == "" {
		t = http.DetectContentType(data)
	}
	if mediaType, _, err := mime.ParseMediaType(t); err == nil && mediaType != "" {
		return mediaType
	}
	return "application/octet-stream"
}

func isMediaType(t string) bool {
	return strings.HasPrefix(t, "image/") || strings.HasPrefix(t, "video/") || strings.HasPrefix(t, "audio/")
}

func printAttachPlan(out io.Writer, rel, uid string, uploads []attachUpload, existing []string) {
	fmt.Fprintf(out, "Attach %d file(s) to %s (memos/%s), mounted:\n", len(uploads), rel, uid)
	for _, up := range uploads {
		fmt.Fprintf(out, "  + %s (%s, %s) <- %s\n", up.filename, up.mimeType, humanSize(int64(len(up.data))), up.source)
	}
	fmt.Fprintf(out, "Already attached: %s\n", listOrNone(existing))
}

// syncAttachedDoc brings the local copy up to date after an upload: downloads
// the new attachments into _attachments/ (the server's bytes, which may differ
// from the local file — image EXIF is stripped on upload), rewrites the
// document's attachment manifest and records the refs in the baseline, so the
// next pull has nothing to do. It is the same step pull takes for a document
// whose only change on the server is its attachments.
func syncAttachedDoc(ctx context.Context, client *Client, root string, ws *WorkspaceConfig, state *State, uid string, out io.Writer) error {
	m, err := client.GetMemo(ctx, uid)
	if err != nil {
		return err
	}
	warn := &attachmentWarner{out: out}
	if err := refreshAttachments(ctx, client, ws, ContentRoot(root, ws), uid, m, state, &PullResult{}, io.Discard, warn); err != nil {
		return err
	}
	return state.Save(root, ws.stateName())
}

// appLink is the document's page in the web app, where attachments are deleted,
// replaced and renamed.
func appLink(cfg *Config, uid string) string {
	return strings.TrimRight(cfg.Server, "/") + "/memos/" + uid
}

func listOrNone(items []string) string {
	if len(items) == 0 {
		return "(none)"
	}
	return strings.Join(items, ", ")
}
