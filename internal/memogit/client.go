package memogit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/proto/gen/api/v1/apiv1connect"
)

// Client wraps the memos Connect API clients with PAT auth and exposes the
// subset of operations memogit needs.
type Client struct {
	memo      apiv1connect.MemoServiceClient
	auth      apiv1connect.AuthServiceClient
	workspace apiv1connect.WorkspaceServiceClient

	// baseURL and token back the raw HTTP calls (attachment download) that go
	// through the /file/ route rather than the Connect API.
	baseURL string
	token   string
	http    *http.Client
}

// patInterceptor injects `Authorization: Bearer <token>` on every request.
type patInterceptor struct {
	token string
}

func (i patInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		req.Header().Set("Authorization", "Bearer "+i.token)
		return next(ctx, req)
	}
}

func (i patInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		conn := next(ctx, spec)
		conn.RequestHeader().Set("Authorization", "Bearer "+i.token)
		return conn
	}
}

func (i patInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

// NewClient builds a Client for the given server URL and PAT.
func NewClient(cfg *Config) *Client {
	httpClient := &http.Client{Timeout: 60 * time.Second}
	baseURL := strings.TrimRight(cfg.Server, "/")
	opts := connect.WithInterceptors(patInterceptor{token: cfg.Token})
	return &Client{
		memo:      apiv1connect.NewMemoServiceClient(httpClient, baseURL, opts),
		auth:      apiv1connect.NewAuthServiceClient(httpClient, baseURL, opts),
		workspace: apiv1connect.NewWorkspaceServiceClient(httpClient, baseURL, opts),
		baseURL:   baseURL,
		token:     cfg.Token,
		http:      httpClient,
	}
}

// CurrentUsername returns the authenticated user's username (used to scope
// list queries to the user's own memos).
func (c *Client) CurrentUsername(ctx context.Context) (string, error) {
	resp, err := c.auth.GetCurrentUser(ctx, connect.NewRequest(&v1pb.GetCurrentUserRequest{}))
	if err != nil {
		return "", fmt.Errorf("get current user (check server URL and token): %w", err)
	}
	user := resp.Msg.GetUser()
	if user == nil || user.GetUsername() == "" {
		return "", fmt.Errorf("current user response missing username")
	}
	return user.GetUsername(), nil
}

// ResolveWorkspace looks up a workspace owned by the current user by its
// display title (unique per user) and returns its resource name
// ("workspaces/{uid}"). There is no server-side title lookup for ListMemos'
// workspace filter (unlike CreateMemo, which accepts a title), so this pages
// through ListWorkspaces client-side and matches by exact title.
func (c *Client) ResolveWorkspace(ctx context.Context, title string) (*v1pb.Workspace, error) {
	resp, err := c.workspace.ListWorkspaces(ctx, connect.NewRequest(&v1pb.ListWorkspacesRequest{}))
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	var names []string
	for _, w := range resp.Msg.GetWorkspaces() {
		names = append(names, w.GetTitle())
		if w.GetTitle() == title {
			return w, nil
		}
	}
	return nil, fmt.Errorf("no workspace titled %q (have: %v)", title, names)
}

// DefaultWorkspace returns the current user's first workspace, matching the
// server's own "first workspace is the default" convention
// (resolveOrCreateDefaultWorkspace). Errors if the user has none yet — the
// server only auto-creates one lazily on first memo write, and clone should
// not silently write to the server.
func (c *Client) DefaultWorkspace(ctx context.Context) (*v1pb.Workspace, error) {
	resp, err := c.workspace.ListWorkspaces(ctx, connect.NewRequest(&v1pb.ListWorkspacesRequest{}))
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	list := resp.Msg.GetWorkspaces()
	if len(list) == 0 {
		return nil, fmt.Errorf("account has no workspaces yet; create one in memos first")
	}
	return list[0], nil
}

// ListAllMemos pages through ListMemos scoped to the given workspace and
// returns every NORMAL memo. filter is a full CEL expression (already
// including any creator scoping); workspace is a resource name
// ("workspaces/{uid}").
func (c *Client) ListAllMemos(ctx context.Context, workspace, filter string) ([]*v1pb.Memo, error) {
	var out []*v1pb.Memo
	pageToken := ""
	for {
		req := &v1pb.ListMemosRequest{
			PageSize:  200,
			PageToken: pageToken,
			State:     v1pb.State_NORMAL,
			// Oldest first keeps clone output deterministic and git-friendly.
			OrderBy:   "create_time asc",
			Filter:    filter,
			Workspace: workspace,
		}
		resp, err := c.memo.ListMemos(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, fmt.Errorf("list memos: %w", err)
		}
		out = append(out, resp.Msg.GetMemos()...)
		pageToken = resp.Msg.GetNextPageToken()
		if pageToken == "" {
			break
		}
	}
	return out, nil
}

// GetMemo fetches a single memo by uid ("memos/{uid}"). Used by push to read the
// server's current state for conflict detection.
func (c *Client) GetMemo(ctx context.Context, uid string) (*v1pb.Memo, error) {
	resp, err := c.memo.GetMemo(ctx, connect.NewRequest(&v1pb.GetMemoRequest{Name: "memos/" + uid}))
	if err != nil {
		return nil, fmt.Errorf("get memo %s: %w", uid, err)
	}
	return resp.Msg, nil
}

// CreateMemo creates a new memo from a local file and returns the server memo
// (with its assigned uid/timestamps). workspace/folderPath/title/docType place
// it in the knowledge base hierarchy; visibility defaults to PRIVATE.
func (c *Client) CreateMemo(ctx context.Context, workspace, folderPath, title, docType, content string) (*v1pb.Memo, error) {
	memo := &v1pb.Memo{
		Content:    content,
		Visibility: v1pb.Visibility_PRIVATE,
		State:      v1pb.State_NORMAL,
		Workspace:  workspace,
		FolderPath: folderPath,
		Title:      title,
		DocType:    docTypeFromString(docType),
	}
	resp, err := c.memo.CreateMemo(ctx, connect.NewRequest(&v1pb.CreateMemoRequest{Memo: memo}))
	if err != nil {
		return nil, fmt.Errorf("create memo %q: %w", title, err)
	}
	return resp.Msg, nil
}

// UpdateMemoContent pushes new content to an existing memo, touching only the
// content field (update_mask=[content]) so other attributes are preserved.
func (c *Client) UpdateMemoContent(ctx context.Context, uid, content string) (*v1pb.Memo, error) {
	req := &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: "memos/" + uid, Content: content},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	}
	resp, err := c.memo.UpdateMemo(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, fmt.Errorf("update memo %s: %w", uid, err)
	}
	return resp.Msg, nil
}

// ArchiveMemo soft-deletes a memo by moving it to the ARCHIVED state
// (update_mask=[state]). memogit never hard-deletes on the server.
func (c *Client) ArchiveMemo(ctx context.Context, uid string) error {
	req := &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: "memos/" + uid, State: v1pb.State_ARCHIVED},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
	}
	if _, err := c.memo.UpdateMemo(ctx, connect.NewRequest(req)); err != nil {
		return fmt.Errorf("archive memo %s: %w", uid, err)
	}
	return nil
}

// DownloadAttachment fetches an attachment's raw bytes via the /file/ route,
// which accepts the same PAT Bearer auth as the Connect API. attachmentName is
// the resource name ("attachments/{uid}"); filename is the display filename.
func (c *Client) DownloadAttachment(ctx context.Context, attachmentName, filename string) ([]byte, error) {
	u := fmt.Sprintf("%s/file/%s/%s", c.baseURL, attachmentName, url.PathEscape(filename))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", filename, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: server returned %s", filename, resp.Status)
	}
	return io.ReadAll(resp.Body)
}
