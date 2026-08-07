package mcp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
)

// stubAuthorizer accepts exactly one bearer token and reports a fixed scope.
type stubAuthorizer struct {
	acceptToken string
	scope       string
}

func (a *stubAuthorizer) AuthorizeMCPRequest(request *http.Request) (string, string, error) {
	if auth.ExtractBearerToken(request.Header.Get("Authorization")) != a.acceptToken {
		return "", "", errors.New("missing or invalid bearer token")
	}
	return "Bearer internal-token", a.scope, nil
}

func (*stubAuthorizer) ResourceMetadataURL(*http.Request) string {
	return "https://kb.example.com/.well-known/oauth-protected-resource"
}

func newAuthorizedTestService(t *testing.T, authorizer Authorizer) *echo.Echo {
	t.Helper()
	echoServer := echo.New()
	service, err := NewMCPService(&profile.Profile{Version: "test-version"}, echoServer, authorizer)
	require.NoError(t, err)
	service.RegisterRoutes(echoServer)
	return echoServer
}

func newInitializeRequest() *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	return request
}

func TestUnauthenticatedRequestGetsOAuthChallenge(t *testing.T) {
	echoServer := newAuthorizedTestService(t, &stubAuthorizer{acceptToken: "good-token"})

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, newInitializeRequest())

	// Without this challenge an MCP client has no way to discover that it should
	// start the OAuth flow — it just sees a failure.
	require.Equal(t, http.StatusUnauthorized, recorder.Code)
	require.Equal(t,
		`Bearer resource_metadata="https://kb.example.com/.well-known/oauth-protected-resource"`,
		recorder.Header().Get("WWW-Authenticate"))
}

func TestAuthenticatedRequestIsServed(t *testing.T) {
	echoServer := newAuthorizedTestService(t, &stubAuthorizer{acceptToken: "good-token", scope: auth.MCPScopeRead})

	request := newInitializeRequest()
	request.Header.Set("Authorization", "Bearer good-token")
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), "serverInfo")
}

func TestClientSuppliedScopeHeaderIsStripped(t *testing.T) {
	authorizer := &recordingAuthorizer{scope: auth.MCPScopeRead}
	echoServer := newAuthorizedTestService(t, authorizer)

	request := newInitializeRequest()
	request.Header.Set("Authorization", "Bearer anything")
	// A client must not be able to grant itself write access by setting the
	// internal scope header.
	request.Header.Set(scopeHeader, auth.MCPScopeWrite)
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Empty(t, authorizer.seenScopeHeader)
}

type recordingAuthorizer struct {
	scope           string
	seenScopeHeader string
}

func (a *recordingAuthorizer) AuthorizeMCPRequest(request *http.Request) (string, string, error) {
	a.seenScopeHeader = request.Header.Get(scopeHeader)
	return "Bearer internal-token", a.scope, nil
}

func (*recordingAuthorizer) ResourceMetadataURL(*http.Request) string {
	return "https://kb.example.com/.well-known/oauth-protected-resource"
}

func TestHasScope(t *testing.T) {
	require.True(t, hasScope("mcp:read mcp:write", auth.MCPScopeWrite))
	require.False(t, hasScope("mcp:read", auth.MCPScopeWrite))
	require.False(t, hasScope("", auth.MCPScopeWrite))
}
