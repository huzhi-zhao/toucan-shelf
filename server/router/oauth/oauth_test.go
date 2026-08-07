package oauth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
)

const testSecret = "test-secret"

func newTestService() (*Service, *echo.Echo) {
	service := NewService(&profile.Profile{InstanceURL: "https://kb.example.com"}, nil, testSecret)
	echoServer := echo.New()
	service.RegisterRoutes(echoServer)
	return service, echoServer
}

func registerTestClient(t *testing.T, redirectURIs ...string) string {
	t.Helper()
	clientID, err := encodeClientID(&clientMetadata{
		ClientName:   "Claude",
		RedirectURIs: redirectURIs,
	}, []byte(testSecret))
	require.NoError(t, err)
	return clientID
}

func TestClientIDRoundTrip(t *testing.T) {
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	metadata, err := decodeClientID(clientID, []byte(testSecret))
	require.NoError(t, err)
	require.Equal(t, "Claude", metadata.ClientName)
	require.Equal(t, []string{"https://claude.ai/api/mcp/auth_callback"}, metadata.RedirectURIs)
}

func TestClientIDRejectsTamperingAndForeignSecrets(t *testing.T) {
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	_, err := decodeClientID(clientID, []byte("another-secret"))
	require.Error(t, err)

	// Flipping a byte of the payload must invalidate the signature, otherwise a
	// caller could rewrite its own redirect_uris.
	tampered := clientIDPrefix + "eyJyZWRpcmVjdF91cmlzIjpbImh0dHBzOi8vZXZpbC5leGFtcGxlIl19." +
		strings.SplitN(strings.TrimPrefix(clientID, clientIDPrefix), ".", 2)[1]
	_, err = decodeClientID(tampered, []byte(testSecret))
	require.Error(t, err)

	_, err = decodeClientID("not-a-client-id", []byte(testSecret))
	require.Error(t, err)
}

func TestValidateRedirectURIs(t *testing.T) {
	require.NoError(t, validateRedirectURIs([]string{"https://claude.ai/api/mcp/auth_callback"}))
	require.NoError(t, validateRedirectURIs([]string{"http://localhost:8765/callback"}))
	require.NoError(t, validateRedirectURIs([]string{"http://127.0.0.1:1/callback"}))
	require.NoError(t, validateRedirectURIs([]string{"com.example.app:/callback"}))

	require.Error(t, validateRedirectURIs(nil))
	require.Error(t, validateRedirectURIs([]string{"http://evil.example/callback"}))
	require.Error(t, validateRedirectURIs([]string{"https://ok.example/cb#fragment"}))
	require.Error(t, validateRedirectURIs([]string{"notaurl"}))
}

func TestMatchRedirectURIIgnoresLoopbackPort(t *testing.T) {
	// RFC 8252: a native client picks its callback port at runtime.
	registered := []string{"http://localhost:1234/callback"}
	require.True(t, matchRedirectURI(registered, "http://localhost:54321/callback"))
	require.False(t, matchRedirectURI(registered, "http://localhost:54321/other"))
	require.False(t, matchRedirectURI(registered, "http://evil.example:54321/callback"))

	// A non-loopback registration stays exact-match only.
	https := []string{"https://claude.ai/api/mcp/auth_callback"}
	require.True(t, matchRedirectURI(https, "https://claude.ai/api/mcp/auth_callback"))
	require.False(t, matchRedirectURI(https, "https://claude.ai/api/mcp/auth_callback2"))
	require.False(t, matchRedirectURI(https, "https://claude.ai.evil.example/api/mcp/auth_callback"))
}

func TestVerifyPKCE(t *testing.T) {
	verifier := strings.Repeat("a", 64)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	require.NoError(t, verifyPKCE(challenge, "S256", verifier))
	require.Error(t, verifyPKCE(challenge, "S256", strings.Repeat("b", 64)))
	require.Error(t, verifyPKCE(challenge, "plain", verifier))
	require.Error(t, verifyPKCE("", "S256", verifier))
	require.Error(t, verifyPKCE(challenge, "S256", "tooshort"))
}

func TestAuthorizationCodeIsSingleUse(t *testing.T) {
	codes := newCodeStore()
	value, err := codes.issue(&authorizationCode{UserID: 7})
	require.NoError(t, err)

	code, err := codes.consume(value)
	require.NoError(t, err)
	require.Equal(t, int32(7), code.UserID)

	_, err = codes.consume(value)
	require.Error(t, err)
}

func TestProtectedResourceMetadata(t *testing.T) {
	_, echoServer := newTestService()

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil))
	require.Equal(t, http.StatusOK, recorder.Code)

	body := map[string]any{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, "https://kb.example.com/mcp", body["resource"])
	require.Equal(t, []any{"https://kb.example.com"}, body["authorization_servers"])
}

func TestAuthorizationServerMetadataAdvertisesPKCE(t *testing.T) {
	_, echoServer := newTestService()

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-authorization-server", nil))
	require.Equal(t, http.StatusOK, recorder.Code)

	body := map[string]any{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, "https://kb.example.com/oauth/authorize", body["authorization_endpoint"])
	require.Equal(t, "https://kb.example.com/oauth/token", body["token_endpoint"])
	require.Equal(t, "https://kb.example.com/oauth/register", body["registration_endpoint"])
	require.Equal(t, []any{"S256"}, body["code_challenge_methods_supported"])
}

func TestBaseURLIgnoresHostHeaderWhenInstanceURLIsSet(t *testing.T) {
	service, _ := newTestService()

	request := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	request.Host = "attacker.example"
	require.Equal(t, "https://kb.example.com/mcp", service.ResourceIdentifier(request))
}

func TestRegisterClient(t *testing.T) {
	_, echoServer := newTestService()

	request := httptest.NewRequest(http.MethodPost, "/oauth/register",
		strings.NewReader(`{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusCreated, recorder.Code)

	body := map[string]any{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	clientID, ok := body["client_id"].(string)
	require.True(t, ok)

	metadata, err := decodeClientID(clientID, []byte(testSecret))
	require.NoError(t, err)
	require.Equal(t, []string{"https://claude.ai/api/mcp/auth_callback"}, metadata.RedirectURIs)
}

func TestRegisterClientRejectsUnsafeRedirectURI(t *testing.T) {
	_, echoServer := newTestService()

	request := httptest.NewRequest(http.MethodPost, "/oauth/register",
		strings.NewReader(`{"client_name":"Evil","redirect_uris":["http://evil.example/cb"]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}

func authorizeURL(clientID string, overrides url.Values) string {
	values := url.Values{
		"client_id":             {clientID},
		"redirect_uri":          {"https://claude.ai/api/mcp/auth_callback"},
		"response_type":         {"code"},
		"code_challenge":        {"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"},
		"code_challenge_method": {"S256"},
		"state":                 {"xyz"},
		"resource":              {"https://kb.example.com/mcp"},
	}
	for key, value := range overrides {
		if value[0] == "" {
			values.Del(key)
			continue
		}
		values[key] = value
	}
	return "/oauth/authorize?" + values.Encode()
}

func TestAuthorizeRedirectsAnonymousVisitorToSignIn(t *testing.T) {
	_, echoServer := newTestService()
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, authorizeURL(clientID, nil), nil))

	require.Equal(t, http.StatusFound, recorder.Code)
	location := recorder.Header().Get("Location")
	require.True(t, strings.HasPrefix(location, "/auth?redirect="), location)
	require.Contains(t, location, url.QueryEscape("/oauth/authorize?"))
}

func TestAuthorizeRejectsUnknownClient(t *testing.T) {
	_, echoServer := newTestService()

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, authorizeURL("mcpc_bogus.sig", nil), nil))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestAuthorizeRejectsUnregisteredRedirectURI(t *testing.T) {
	_, echoServer := newTestService()
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		authorizeURL(clientID, url.Values{"redirect_uri": {"https://evil.example/cb"}}), nil))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestAuthorizeRejectsForeignResource(t *testing.T) {
	_, echoServer := newTestService()
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		authorizeURL(clientID, url.Values{"resource": {"https://other.example/mcp"}}), nil))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestAuthorizeRequiresPKCE(t *testing.T) {
	_, echoServer := newTestService()
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		authorizeURL(clientID, url.Values{"code_challenge": {""}}), nil))

	// The error goes back to the client through the redirect, not to the user.
	require.Equal(t, http.StatusFound, recorder.Code)
	location, err := url.Parse(recorder.Header().Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "invalid_request", location.Query().Get("error"))
	require.Equal(t, "xyz", location.Query().Get("state"))
}

func TestTokenRejectsUnsupportedGrant(t *testing.T) {
	_, echoServer := newTestService()

	request := httptest.NewRequest(http.MethodPost, "/oauth/token",
		strings.NewReader("grant_type=password&username=a&password=b"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Contains(t, recorder.Body.String(), "unsupported_grant_type")
}

func TestTokenRejectsCodeWithWrongVerifier(t *testing.T) {
	service, echoServer := newTestService()
	clientID := registerTestClient(t, "https://claude.ai/api/mcp/auth_callback")

	verifier := strings.Repeat("a", 64)
	sum := sha256.Sum256([]byte(verifier))
	code, err := service.codes.issue(&authorizationCode{
		UserID:              1,
		ClientID:            clientID,
		RedirectURI:         "https://claude.ai/api/mcp/auth_callback",
		Scope:               auth.MCPScopeRead,
		Resource:            "https://kb.example.com/mcp",
		CodeChallenge:       base64.RawURLEncoding.EncodeToString(sum[:]),
		CodeChallengeMethod: "S256",
	})
	require.NoError(t, err)

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {clientID},
		"code_verifier": {strings.Repeat("b", 64)},
	}
	request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	recorder := httptest.NewRecorder()
	echoServer.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Contains(t, recorder.Body.String(), "invalid_grant")
}

func TestMCPAccessTokenIsBoundToItsResource(t *testing.T) {
	token, _, err := auth.GenerateMCPAccessToken(1, "client", auth.MCPScopeRead, "https://kb.example.com/mcp", []byte(testSecret))
	require.NoError(t, err)

	claims, err := auth.ParseMCPAccessToken(token, "https://kb.example.com/mcp", []byte(testSecret))
	require.NoError(t, err)
	require.Equal(t, auth.MCPScopeRead, claims.Scope)

	_, err = auth.ParseMCPAccessToken(token, "https://other.example/mcp", []byte(testSecret))
	require.Error(t, err)
}

func TestMCPAccessTokenIsNotAcceptedAsAnAPIAccessToken(t *testing.T) {
	// The whole point of the separate audience: an MCP token must be useless
	// against the regular API.
	token, _, err := auth.GenerateMCPAccessToken(1, "client", auth.MCPScopeWrite, "https://kb.example.com/mcp", []byte(testSecret))
	require.NoError(t, err)

	_, err = auth.ParseAccessTokenV2(token, []byte(testSecret))
	require.Error(t, err)
}

func TestNormalizeScope(t *testing.T) {
	scope, err := normalizeScope("")
	require.NoError(t, err)
	require.Equal(t, "mcp:read mcp:write", scope)

	scope, err = normalizeScope("mcp:read mcp:read")
	require.NoError(t, err)
	require.Equal(t, "mcp:read", scope)

	_, err = normalizeScope("admin")
	require.Error(t, err)

	require.True(t, isSubsetScope("mcp:read", "mcp:read mcp:write"))
	require.False(t, isSubsetScope("mcp:write", "mcp:read"))
}
