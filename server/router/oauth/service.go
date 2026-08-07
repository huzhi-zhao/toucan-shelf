// Package oauth implements the OAuth 2.1 authorization server that fronts the
// MCP endpoint, so that MCP clients (Claude connectors among them) can obtain a
// token interactively instead of being handed a personal access token out of band.
//
// It implements the discovery + registration + code-exchange surface the MCP
// authorization spec requires:
//
//	GET  /.well-known/oauth-protected-resource   RFC 9728 protected resource metadata
//	GET  /.well-known/oauth-authorization-server RFC 8414 authorization server metadata
//	POST /oauth/register                         RFC 7591 dynamic client registration
//	GET  /oauth/authorize                        consent screen
//	POST /oauth/authorize                        consent decision -> redirect with code
//	POST /oauth/token                            authorization_code + refresh_token grants
//	POST /oauth/revoke                           RFC 7009 token revocation
//
// Tokens minted here are scoped to the MCP resource and are not accepted by the
// regular API interceptors; see server/auth/mcp_token.go.
package oauth

import (
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/util"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// MCPResourcePath is the path of the protected resource this server guards.
	MCPResourcePath = "/mcp"

	authorizePath = "/oauth/authorize"
	tokenPath     = "/oauth/token"
	registerPath  = "/oauth/register"
	revokePath    = "/oauth/revoke"
)

var supportedScopes = []string{auth.MCPScopeRead, auth.MCPScopeWrite}

// Service serves the OAuth authorization endpoints for the MCP resource.
type Service struct {
	store         *store.Store
	profile       *profile.Profile
	secret        string
	authenticator *auth.Authenticator
	codes         *codeStore
}

// NewService creates the OAuth service.
func NewService(profile *profile.Profile, store *store.Store, secret string) *Service {
	return &Service{
		store:         store,
		profile:       profile,
		secret:        secret,
		authenticator: auth.NewAuthenticator(store, secret),
		codes:         newCodeStore(),
	}
}

// RegisterRoutes registers the discovery and OAuth endpoints.
func (s *Service) RegisterRoutes(echoServer *echo.Echo) {
	echoServer.GET("/.well-known/oauth-protected-resource", s.getProtectedResourceMetadata)
	// Clients that predate RFC 9728 path insertion probe the suffixed form.
	echoServer.GET("/.well-known/oauth-protected-resource/mcp", s.getProtectedResourceMetadata)
	echoServer.GET("/.well-known/oauth-authorization-server", s.getAuthorizationServerMetadata)
	echoServer.GET("/.well-known/oauth-authorization-server/mcp", s.getAuthorizationServerMetadata)

	echoServer.POST(registerPath, s.registerClient)
	echoServer.GET(authorizePath, s.showAuthorizePage)
	echoServer.POST(authorizePath, s.handleAuthorizeDecision)
	echoServer.POST(tokenPath, s.handleToken)
	echoServer.POST(revokePath, s.handleRevoke)
}

// BaseURL returns the externally reachable origin of this instance.
//
// InstanceURL wins when configured: behind a reverse proxy the Host header is
// the only other signal and it is attacker-controllable, which would let a
// forged Host poison the discovery documents.
func (s *Service) BaseURL(request *http.Request) string {
	if s.profile != nil && s.profile.InstanceURL != "" {
		return strings.TrimSuffix(s.profile.InstanceURL, "/")
	}
	scheme := "http"
	if request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + request.Host
}

// ResourceIdentifier returns the canonical RFC 8707 resource identifier of the
// MCP endpoint. Every token is bound to it and validated against it.
func (s *Service) ResourceIdentifier(request *http.Request) string {
	return s.BaseURL(request) + MCPResourcePath
}

func (s *Service) getProtectedResourceMetadata(c *echo.Context) error {
	baseURL := s.BaseURL(c.Request())
	return c.JSON(http.StatusOK, map[string]any{
		"resource":                 baseURL + MCPResourcePath,
		"authorization_servers":    []string{baseURL},
		"scopes_supported":         supportedScopes,
		"bearer_methods_supported": []string{"header"},
	})
}

func (s *Service) getAuthorizationServerMetadata(c *echo.Context) error {
	baseURL := s.BaseURL(c.Request())
	return c.JSON(http.StatusOK, map[string]any{
		"issuer":                                baseURL,
		"authorization_endpoint":                baseURL + authorizePath,
		"token_endpoint":                        baseURL + tokenPath,
		"registration_endpoint":                 baseURL + registerPath,
		"revocation_endpoint":                   baseURL + revokePath,
		"scopes_supported":                      supportedScopes,
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
	})
}

// registerClient implements RFC 7591 dynamic client registration.
func (s *Service) registerClient(c *echo.Context) error {
	body := struct {
		ClientName              string   `json:"client_name"`
		RedirectURIs            []string `json:"redirect_uris"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
		GrantTypes              []string `json:"grant_types"`
	}{}
	if err := c.Bind(&body); err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_client_metadata", "malformed registration request")
	}
	if err := validateRedirectURIs(body.RedirectURIs); err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_redirect_uri", err.Error())
	}
	if body.TokenEndpointAuthMethod != "" && body.TokenEndpointAuthMethod != "none" {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_client_metadata",
			"only public clients (token_endpoint_auth_method=none) are supported")
	}

	clientName := strings.TrimSpace(body.ClientName)
	if len(clientName) > 100 {
		clientName = clientName[:100]
	}
	clientID, err := encodeClientID(&clientMetadata{
		ClientName:   clientName,
		RedirectURIs: body.RedirectURIs,
		IssuedAt:     time.Now().Unix(),
	}, []byte(s.secret))
	if err != nil {
		return writeOAuthError(c, http.StatusInternalServerError, "server_error", "failed to register client")
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"client_id":                  clientID,
		"client_id_issued_at":        time.Now().Unix(),
		"client_name":                clientName,
		"redirect_uris":              body.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
	})
}

// authorizeRequest is a validated /oauth/authorize query.
type authorizeRequest struct {
	Client              *clientMetadata
	ClientID            string
	RedirectURI         string
	State               string
	Scope               string
	Resource            string
	CodeChallenge       string
	CodeChallengeMethod string
}

// formFields renders the authorization request as the hidden fields the consent
// form posts back, so the POST re-parses exactly the request the user saw.
func (r *authorizeRequest) formFields() []formField {
	fields := []formField{
		{Name: "response_type", Value: "code"},
		{Name: "client_id", Value: r.ClientID},
		{Name: "redirect_uri", Value: r.RedirectURI},
		{Name: "scope", Value: r.Scope},
		{Name: "resource", Value: r.Resource},
		{Name: "code_challenge", Value: r.CodeChallenge},
		{Name: "code_challenge_method", Value: r.CodeChallengeMethod},
	}
	if r.State != "" {
		fields = append(fields, formField{Name: "state", Value: r.State})
	}
	return fields
}

func (s *Service) parseAuthorizeRequest(c *echo.Context) (*authorizeRequest, error) {
	request := c.Request()
	values := request.URL.Query()
	if request.Method == http.MethodPost {
		if err := request.ParseForm(); err != nil {
			return nil, errors.New("malformed request")
		}
		values = request.PostForm
	}

	clientID := values.Get("client_id")
	client, err := decodeClientID(clientID, []byte(s.secret))
	if err != nil {
		return nil, errors.Wrap(err, "unknown client")
	}
	redirectURI := values.Get("redirect_uri")
	if redirectURI == "" {
		if len(client.RedirectURIs) != 1 {
			return nil, errors.New("redirect_uri is required")
		}
		redirectURI = client.RedirectURIs[0]
	}
	if !matchRedirectURI(client.RedirectURIs, redirectURI) {
		return nil, errors.New("redirect_uri does not match the registered redirect URIs")
	}
	if responseType := values.Get("response_type"); responseType != "code" {
		return nil, errors.Errorf("unsupported response_type: %q", responseType)
	}

	// The resource indicator is what binds the issued token to this MCP endpoint.
	// A request naming someone else's resource is refused rather than silently
	// rewritten, so a client tricked into pointing here cannot obtain a token it
	// would then hand to another server.
	resource := values.Get("resource")
	expectedResource := s.ResourceIdentifier(request)
	if resource == "" {
		resource = expectedResource
	} else if strings.TrimSuffix(resource, "/") != strings.TrimSuffix(expectedResource, "/") {
		return nil, errors.Errorf("resource %q is not served by this authorization server", resource)
	}

	scope, err := normalizeScope(values.Get("scope"))
	if err != nil {
		return nil, err
	}

	return &authorizeRequest{
		Client:              client,
		ClientID:            clientID,
		RedirectURI:         redirectURI,
		State:               values.Get("state"),
		Scope:               scope,
		Resource:            expectedResource,
		CodeChallenge:       values.Get("code_challenge"),
		CodeChallengeMethod: values.Get("code_challenge_method"),
	}, nil
}

func (s *Service) showAuthorizePage(c *echo.Context) error {
	request, err := s.parseAuthorizeRequest(c)
	if err != nil {
		return renderErrorPage(c, http.StatusBadRequest, err.Error())
	}
	if request.CodeChallenge == "" || request.CodeChallengeMethod != "S256" {
		return redirectWithError(c, request, "invalid_request", "PKCE with code_challenge_method=S256 is required")
	}

	user, err := s.currentUser(c)
	if err != nil {
		return renderErrorPage(c, http.StatusInternalServerError, "failed to resolve the signed-in user")
	}
	if user == nil {
		// Bounce through the normal sign-in page and come straight back here.
		// getSafeRedirectPath in the web app accepts this path, and the sign-in
		// form does a full page load for /oauth/* so the server route is hit.
		target := c.Request().URL.RequestURI()
		return c.Redirect(http.StatusFound, "/auth?redirect="+url.QueryEscape(target))
	}

	return renderConsentPage(c, consentPageData{
		ClientName: request.Client.ClientName,
		Username:   user.Username,
		Scope:      request.Scope,
		Params:     request.formFields(),
	})
}

func (s *Service) handleAuthorizeDecision(c *echo.Context) error {
	request, err := s.parseAuthorizeRequest(c)
	if err != nil {
		return renderErrorPage(c, http.StatusBadRequest, err.Error())
	}
	if request.CodeChallenge == "" || request.CodeChallengeMethod != "S256" {
		return redirectWithError(c, request, "invalid_request", "PKCE with code_challenge_method=S256 is required")
	}

	user, err := s.currentUser(c)
	if err != nil {
		return renderErrorPage(c, http.StatusInternalServerError, "failed to resolve the signed-in user")
	}
	if user == nil {
		return renderErrorPage(c, http.StatusUnauthorized, "your session expired, please sign in again")
	}
	if c.Request().PostForm.Get("decision") != "allow" {
		return redirectWithError(c, request, "access_denied", "the user denied the request")
	}

	code, err := s.codes.issue(&authorizationCode{
		UserID:              user.ID,
		ClientID:            request.ClientID,
		RedirectURI:         request.RedirectURI,
		Scope:               request.Scope,
		Resource:            request.Resource,
		CodeChallenge:       request.CodeChallenge,
		CodeChallengeMethod: request.CodeChallengeMethod,
	})
	if err != nil {
		return redirectWithError(c, request, "server_error", "failed to issue an authorization code")
	}

	redirectURL, err := url.Parse(request.RedirectURI)
	if err != nil {
		return renderErrorPage(c, http.StatusBadRequest, "invalid redirect_uri")
	}
	query := redirectURL.Query()
	query.Set("code", code)
	if request.State != "" {
		query.Set("state", request.State)
	}
	redirectURL.RawQuery = query.Encode()
	return c.Redirect(http.StatusFound, redirectURL.String())
}

func (s *Service) handleToken(c *echo.Context) error {
	request := c.Request()
	if err := request.ParseForm(); err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_request", "malformed token request")
	}
	switch request.PostForm.Get("grant_type") {
	case "authorization_code":
		return s.handleAuthorizationCodeGrant(c)
	case "refresh_token":
		return s.handleRefreshTokenGrant(c)
	default:
		return writeOAuthError(c, http.StatusBadRequest, "unsupported_grant_type", "unsupported grant_type")
	}
}

func (s *Service) handleAuthorizationCodeGrant(c *echo.Context) error {
	form := c.Request().PostForm
	code, err := s.codes.consume(form.Get("code"))
	if err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", err.Error())
	}
	if code.ClientID != form.Get("client_id") {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "code was issued to a different client")
	}
	if redirectURI := form.Get("redirect_uri"); redirectURI != "" && redirectURI != code.RedirectURI {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "redirect_uri mismatch")
	}
	if err := verifyPKCE(code.CodeChallenge, code.CodeChallengeMethod, form.Get("code_verifier")); err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", err.Error())
	}
	if resource := form.Get("resource"); resource != "" &&
		strings.TrimSuffix(resource, "/") != strings.TrimSuffix(code.Resource, "/") {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_target", "resource mismatch")
	}

	return s.issueTokenPair(c, code.UserID, code.ClientID, code.Scope, code.Resource, clientDisplayName(code.ClientID, []byte(s.secret)))
}

func (s *Service) handleRefreshTokenGrant(c *echo.Context) error {
	ctx := c.Request().Context()
	form := c.Request().PostForm

	claims, err := auth.ParseMCPRefreshToken(form.Get("refresh_token"), []byte(s.secret))
	if err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "invalid refresh token")
	}
	if clientID := form.Get("client_id"); clientID != "" && clientID != claims.ClientID {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "refresh token was issued to a different client")
	}
	userID, err := util.ConvertStringToInt32(claims.Subject)
	if err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "invalid refresh token")
	}

	// Revocation check: the record is what the user can delete from settings.
	record, err := s.store.GetUserRefreshTokenByID(ctx, userID, claims.TokenID)
	if err != nil || record == nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "refresh token has been revoked")
	}
	if record.ExpiresAt != nil && record.ExpiresAt.AsTime().Before(time.Now()) {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "refresh token expired")
	}

	scope := claims.Scope
	if requested := form.Get("scope"); requested != "" {
		narrowed, err := normalizeScope(requested)
		if err != nil {
			return writeOAuthError(c, http.StatusBadRequest, "invalid_scope", err.Error())
		}
		if !isSubsetScope(narrowed, claims.Scope) {
			return writeOAuthError(c, http.StatusBadRequest, "invalid_scope", "requested scope exceeds the granted scope")
		}
		scope = narrowed
	}

	// Rotate: the old refresh token is dropped as the new one is stored, so a
	// leaked refresh token stops working the moment the real client refreshes.
	if err := s.store.RemoveUserRefreshToken(ctx, userID, claims.TokenID); err != nil {
		slog.Error("failed to rotate MCP refresh token", "error", err)
	}
	return s.issueTokenPair(c, userID, claims.ClientID, scope, claims.Resource, record.Description)
}

func (s *Service) issueTokenPair(c *echo.Context, userID int32, clientID, scope, resource, description string) error {
	ctx := c.Request().Context()

	user, err := s.store.GetUser(ctx, &store.FindUser{ID: &userID})
	if err != nil || user == nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "user not found")
	}
	if user.RowStatus == store.Archived {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_grant", "user is archived")
	}

	accessToken, expiresAt, err := auth.GenerateMCPAccessToken(userID, clientID, scope, resource, []byte(s.secret))
	if err != nil {
		return writeOAuthError(c, http.StatusInternalServerError, "server_error", "failed to issue an access token")
	}

	tokenID := util.GenUUID()
	refreshToken, refreshExpiresAt, err := auth.GenerateMCPRefreshToken(userID, tokenID, clientID, scope, resource, []byte(s.secret))
	if err != nil {
		return writeOAuthError(c, http.StatusInternalServerError, "server_error", "failed to issue a refresh token")
	}
	if err := s.store.AddUserRefreshToken(ctx, userID, &storepb.RefreshTokensUserSetting_RefreshToken{
		TokenId:     tokenID,
		ExpiresAt:   timestamppb.New(refreshExpiresAt),
		CreatedAt:   timestamppb.Now(),
		Description: description,
	}); err != nil {
		return writeOAuthError(c, http.StatusInternalServerError, "server_error", "failed to persist the refresh token")
	}

	c.Response().Header().Set("Cache-Control", "no-store")
	return c.JSON(http.StatusOK, map[string]any{
		"access_token":  accessToken,
		"token_type":    "Bearer",
		"expires_in":    int(time.Until(expiresAt).Seconds()),
		"refresh_token": refreshToken,
		"scope":         scope,
	})
}

func (s *Service) handleRevoke(c *echo.Context) error {
	request := c.Request()
	if err := request.ParseForm(); err != nil {
		return writeOAuthError(c, http.StatusBadRequest, "invalid_request", "malformed revocation request")
	}
	// RFC 7009: an unknown or already-invalid token is not an error.
	claims, err := auth.ParseMCPRefreshToken(request.PostForm.Get("token"), []byte(s.secret))
	if err == nil {
		if userID, convErr := util.ConvertStringToInt32(claims.Subject); convErr == nil {
			if err := s.store.RemoveUserRefreshToken(request.Context(), userID, claims.TokenID); err != nil {
				slog.Error("failed to revoke MCP refresh token", "error", err)
			}
		}
	}
	return c.NoContent(http.StatusOK)
}

// currentUser resolves the browser session behind a consent request.
// Returns (nil, nil) when the visitor is not signed in.
func (s *Service) currentUser(c *echo.Context) (*store.User, error) {
	refreshToken := auth.ExtractRefreshTokenFromCookie(c.Request().Header.Get("Cookie"))
	if refreshToken == "" {
		return nil, nil
	}
	user, _, err := s.authenticator.AuthenticateByRefreshToken(c.Request().Context(), refreshToken)
	if err != nil {
		return nil, nil
	}
	return user, nil
}

func clientDisplayName(clientID string, secret []byte) string {
	name := "MCP client"
	if metadata, err := decodeClientID(clientID, secret); err == nil && metadata.ClientName != "" {
		name = metadata.ClientName
	}
	return "MCP: " + name
}

func normalizeScope(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return strings.Join(supportedScopes, " "), nil
	}
	granted := make([]string, 0, len(supportedScopes))
	for _, scope := range strings.Fields(raw) {
		if !slices.Contains(supportedScopes, scope) {
			return "", errors.Errorf("unsupported scope: %q", scope)
		}
		if !slices.Contains(granted, scope) {
			granted = append(granted, scope)
		}
	}
	return strings.Join(granted, " "), nil
}

func isSubsetScope(narrowed, granted string) bool {
	grantedScopes := strings.Fields(granted)
	for _, scope := range strings.Fields(narrowed) {
		if !slices.Contains(grantedScopes, scope) {
			return false
		}
	}
	return true
}

func writeOAuthError(c *echo.Context, statusCode int, code, description string) error {
	c.Response().Header().Set("Cache-Control", "no-store")
	return c.JSON(statusCode, map[string]string{
		"error":             code,
		"error_description": description,
	})
}

func redirectWithError(c *echo.Context, request *authorizeRequest, code, description string) error {
	redirectURL, err := url.Parse(request.RedirectURI)
	if err != nil {
		return renderErrorPage(c, http.StatusBadRequest, description)
	}
	query := redirectURL.Query()
	query.Set("error", code)
	query.Set("error_description", description)
	if request.State != "" {
		query.Set("state", request.State)
	}
	redirectURL.RawQuery = query.Encode()
	return c.Redirect(http.StatusFound, redirectURL.String())
}
