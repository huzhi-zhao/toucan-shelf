package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/labstack/echo/v5"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"

	"github.com/usememos/memos/internal/profile"
	memosproto "github.com/usememos/memos/proto"
	"github.com/usememos/memos/server/auth"
)

// serverInstructions is returned in the `initialize` response and injected into
// the model's system prompt by clients that support it. It exists because the
// tool names and descriptions are derived from the OpenAPI spec, which still
// speaks the upstream "scratch-note app" dialect ("memo") and says nothing about
// the knowledge-base structure or about the write semantics that can silently
// destroy content.
//
// Like `tools/list`, this text is resident context for the whole session, so
// every sentence must earn its place: it may only carry what the model cannot
// infer from the tool names and schemas — the hierarchy, the order to chain
// calls in, how documents reference each other, and the fact that an update is
// a full-content replacement.
//
// The constraint is precision first, brevity second, and there is deliberately
// no length limit (see TestMCPInitializeReturnsServerInstructions for why the
// old byte ceiling was removed). Say each rule in the fewest words that leave
// exactly one reading — but never trade an unambiguous rule for a shorter one.
// An agent that misreads a rule here silently destroys a document; an agent
// that reads a few more tokens does not. If the text has to shrink, drop a
// whole topic rather than compressing one into something that reads fine and
// means less.
//
// This is a hand-written summary of docs/skill/SKILL.md (the single source of
// truth for agent-facing operating rules, also embedded verbatim for the
// memogit/file channel — see internal/memogit/agentdocs.go). It is not
// generated: MCP's context budget can't fit SKILL.md plus references/ in
// full, only the "两者"/"仅 MCP" rules that apply here. Editing SKILL.md or
// references/*.md means checking whether this needs a matching update — see
// the Change Routing table in AGENTS.md and
// docs/dev/requirements/collaboration/agent-manual-unification.md.
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

Writing:
- Plain Markdown. Never author callouts, ==highlight== or click counters, even
  on request; keep existing ones verbatim. No punctuation in headings.
- Reference another document with [text](/folder/Title): a path from the
  workspace root whose last segment is the target's title (no extension).
  Percent-encode spaces in the destination - [x](/Notes/Long Report) does not
  parse, [x](/Notes/Long%20Report) does. Across knowledge bases prefix the
  target's knowledge-base title: [x](@Handbook/Notes/Long%20Report).
  ![](...) is media only and never a document reference. Do not hand-write
  /memos/{uid} links.

Updating:
- memo_update_memo replaces the whole content field; it is not an incremental
  patch. Always memo_get_memo first, edit the full text, then write it back.
- There is no concurrency check: edits made in the web UI between your read and
  your write are silently overwritten.
- Writable fields: content, title, folder_path, workspace, state, pinned. Any
  other update_mask path is rejected. There is no delete tool; archiving through
  state is the closest thing, and it is reversible.

Attachments:
- memo_get_memo lists them but carries no bytes. attachment_get_download_url
  turns one into a short-lived URL: fetch it to a local file and read that.
- Read-only here: no upload, no replace, no delete.`

// scopeHeader carries the scopes granted to an OAuth-authenticated session from
// the endpoint handler down to the individual tool handlers. It is set on the
// inbound request after the token is validated and is never trusted from the
// wire: RegisterRoutes strips whatever the client sent first.
const scopeHeader = "X-Memos-MCP-Scope"

// originHeader carries the scheme+host the MCP request actually arrived on down
// to the tool handlers, which replay it against a synthetic in-process request
// whose own Host is a stand-in. A handler that has to build an absolute URL
// back to this instance (attachment downloads) needs the real one.
//
// Set from the request itself, never from the wire: RegisterRoutes strips
// whatever the client sent, exactly as it does for scopeHeader.
const originHeader = "X-Memos-MCP-Origin"

// Authorizer validates the credentials on an MCP request.
//
// It is satisfied by server/router/oauth.Service. The interface keeps the MCP
// package free of any OAuth machinery and avoids an import cycle.
type Authorizer interface {
	// AuthorizeMCPRequest validates the request's Authorization header. It
	// returns the Authorization header value the internal API call should use
	// and the space-delimited scopes granted, or an error if the credential is
	// missing or invalid.
	AuthorizeMCPRequest(request *http.Request) (authorization string, scope string, err error)
	// ResourceMetadataURL is the RFC 9728 metadata URL advertised in the
	// WWW-Authenticate challenge of a 401 response.
	ResourceMetadataURL(request *http.Request) string
}

// MCPService serves the OpenAPI-driven MCP endpoint.
type MCPService struct {
	profile    *profile.Profile
	authorizer Authorizer

	operationsByTool map[string]*registeredOperation
	handler          http.Handler
}

// NewMCPService creates an MCP service backed by the in-process API routes.
//
// authorizer may be nil, in which case the endpoint performs no authentication
// of its own and forwards the client's Authorization header to the internal API
// unchanged (the pre-OAuth behaviour).
func NewMCPService(profile *profile.Profile, echoServer *echo.Echo, authorizer Authorizer) (*MCPService, error) {
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
		authorizer:       authorizer,
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

		authorization, scope, origin := "", "", ""
		if request.Extra != nil {
			authorization = request.Extra.Header.Get("Authorization")
			scope = request.Extra.Header.Get(scopeHeader)
			origin = request.Extra.Header.Get(originHeader)
		}
		// A scope is only present on OAuth-authenticated sessions; a personal
		// access token carries the whole account and is left unrestricted, as
		// it always has been.
		if scope != "" && operation.Method != http.MethodGet && !hasScope(scope, auth.MCPScopeWrite) {
			return newToolErrorResult("this connection was not granted the " + auth.MCPScopeWrite + " scope"), nil
		}
		return adapter.execute(ctx, operation.Operation, arguments, authorization, origin)
	}
}

// RegisterRoutes registers the streamable HTTP MCP endpoint.
func (s *MCPService) RegisterRoutes(echoServer *echo.Echo) {
	echoServer.Any("/mcp", func(c *echo.Context) error {
		request := c.Request()
		if !isAllowedMCPOrigin(request.Host, request.Header.Get("Origin"), s.profile) {
			return c.NoContent(http.StatusForbidden)
		}
		// Unconditionally: a client must never be able to name the origin a tool
		// handler will build absolute URLs from. The Host is trustworthy here
		// only because isAllowedMCPOrigin has just vetted it.
		request.Header.Del(originHeader)
		request.Header.Set(originHeader, requestOrigin(request))

		if s.authorizer != nil {
			// Never let a client smuggle its own scope grant in.
			request.Header.Del(scopeHeader)

			authorization, scope, err := s.authorizer.AuthorizeMCPRequest(request)
			if err != nil {
				// The WWW-Authenticate challenge is what tells an MCP client to
				// start the OAuth flow; without it the client has no way to
				// discover that this endpoint is protected. See RFC 9728 §5.1.
				c.Response().Header().Set("WWW-Authenticate",
					`Bearer resource_metadata="`+s.authorizer.ResourceMetadataURL(request)+`"`)
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error":             "invalid_token",
					"error_description": err.Error(),
				})
			}
			request.Header.Set("Authorization", authorization)
			if scope != "" {
				request.Header.Set(scopeHeader, scope)
			}
		}
		s.handler.ServeHTTP(c.Response(), request)
		return nil
	})
}

func hasScope(scope, wanted string) bool {
	return slices.Contains(strings.Fields(scope), wanted)
}
