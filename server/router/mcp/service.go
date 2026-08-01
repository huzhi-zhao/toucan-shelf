package mcp

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/labstack/echo/v5"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"

	"github.com/usememos/memos/internal/profile"
	memosproto "github.com/usememos/memos/proto"
)

// serverInstructions is returned in the `initialize` response and injected into
// the model's system prompt by clients that support it. It exists because the
// tool names and descriptions are derived from the OpenAPI spec, which still
// speaks the upstream "scratch-note app" dialect ("memo") and says nothing about
// the knowledge-base structure or about the write semantics that can silently
// destroy content.
//
// Keep it short. Like `tools/list`, this text is resident context for the whole
// session, so it must only carry what the model cannot infer from the tool names
// and schemas: the hierarchy, the order to chain calls in, and the fact that an
// update is a full-content replacement.
const serverInstructions = `ToucanShelf is a hierarchical knowledge base
(workspace -> folder tree -> document), not a scratch-note app. Tool names keep
the underlying CRUD naming: a "memo" is a document.

Locating a document:
1. workspace_list_workspaces - which knowledge bases exist. A name the user
   types is a display name; resolve it to workspaces/{uid} before use.
2. workspace_get_workspace_tree - folder structure; prefer this when addressing
   a document by its path
3. rag_search - semantic/keyword search when you only know the topic
4. memo_get_memo - read the full content

Creating:
- memo_create_memo takes workspace, folder_path ("folder a/folder b", relative
  to the workspace root; empty means root), title and content.
- Folders are path prefixes: writing to a path that does not exist yet makes it
  appear. There is no folder-creation step.
- title is the document's display name and takes NO file extension. Pass
  "plan", not "plan.md".

Updating:
- memo_update_memo replaces the whole content field; it is not an incremental
  patch. Always memo_get_memo first, edit the full text, then write it back.
- There is no concurrency check: edits made in the web UI between your read and
  your write are silently overwritten.
- Writable fields: content, title, folder_path, workspace, state, pinned. Any
  other update_mask path is rejected. There is no delete tool; archiving through
  state is the closest thing, and it is reversible.`

// MCPService serves the OpenAPI-driven MCP endpoint.
type MCPService struct {
	profile *profile.Profile

	operationsByTool map[string]*registeredOperation
	handler          http.Handler
}

// NewMCPService creates an MCP service backed by the in-process API routes.
func NewMCPService(profile *profile.Profile, echoServer *echo.Echo) (*MCPService, error) {
	spec, err := loadMCPServiceOpenAPISpec()
	if err != nil {
		return nil, err
	}
	registry, err := buildOperationRegistry(spec)
	if err != nil {
		return nil, err
	}
	tools, operationsByTool, err := buildCuratedTools(registry)
	if err != nil {
		return nil, err
	}

	version := "dev"
	if profile != nil && profile.Version != "" {
		version = profile.Version
	}
	server := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    "memos",
		Version: version,
	}, &sdkmcp.ServerOptions{
		Instructions: serverInstructions,
	})

	adapter := newAPIAdapter(echoServer)
	for _, tool := range tools {
		operation := operationsByTool[tool.Name]
		server.AddTool(tool, newMCPToolHandler(adapter, operation))
	}

	handler := sdkmcp.NewStreamableHTTPHandler(func(*http.Request) *sdkmcp.Server {
		return server
	}, &sdkmcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
		// memos is typically served behind a reverse proxy with the app bound to a
		// loopback address while the public Host header is a real domain. The SDK's
		// DNS-rebinding guard treats that shape as an attack and rejects every
		// request with 403 ("invalid Host header"). Disable it and rely on memos'
		// own Origin/Host allowlist (see RegisterRoutes -> isAllowedMCPOrigin) for
		// CSRF / DNS-rebinding protection instead.
		DisableLocalhostProtection: true,
	})

	return &MCPService{
		profile:          profile,
		operationsByTool: operationsByTool,
		handler:          handler,
	}, nil
}

func loadMCPServiceOpenAPISpec() (*openAPISpec, error) {
	spec := &openAPISpec{}
	if err := yaml.Unmarshal(memosproto.OpenAPIYAML(), spec); err != nil {
		return nil, errors.Wrap(err, "failed to parse embedded OpenAPI spec")
	}
	if spec.Paths == nil {
		return nil, errors.New("embedded OpenAPI spec has no paths")
	}
	return spec, nil
}

func newMCPToolHandler(adapter *apiAdapter, operation *registeredOperation) sdkmcp.ToolHandler {
	return func(ctx context.Context, request *sdkmcp.CallToolRequest) (*sdkmcp.CallToolResult, error) {
		arguments := map[string]any{}
		if request.Params != nil && len(request.Params.Arguments) > 0 {
			if err := json.Unmarshal(request.Params.Arguments, &arguments); err != nil {
				return newToolErrorResult(errors.Wrap(err, "failed to decode MCP tool arguments").Error()), nil
			}
		}
		if err := validateToolArguments(operation.InputSchema, arguments); err != nil {
			return newToolErrorResult(err.Error()), nil
		}

		authorization := ""
		if request.Extra != nil {
			authorization = request.Extra.Header.Get("Authorization")
		}
		return adapter.execute(ctx, operation.Operation, arguments, authorization)
	}
}

// RegisterRoutes registers the streamable HTTP MCP endpoint.
func (s *MCPService) RegisterRoutes(echoServer *echo.Echo) {
	echoServer.Any("/mcp", func(c *echo.Context) error {
		request := c.Request()
		if !isAllowedMCPOrigin(request.Host, request.Header.Get("Origin"), s.profile) {
			return c.NoContent(http.StatusForbidden)
		}
		s.handler.ServeHTTP(c.Response(), request)
		return nil
	})
}
