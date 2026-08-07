package auth

import (
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pkg/errors"
)

// Tokens issued by the MCP OAuth authorization server (see server/router/oauth).
//
// These deliberately use their own audiences so that neither the Connect/gRPC
// interceptors nor the file server ever accept them: an MCP token is only
// meaningful at the `/mcp` endpoint, which validates it and then mints an
// ordinary short-lived access token for the internal API call. Reusing
// AccessTokenAudienceName here would turn every MCP token into a full-power
// API credential.
const (
	// MCPAccessTokenAudienceName is the audience claim for MCP OAuth access tokens.
	MCPAccessTokenAudienceName = "mcp.access-token"

	// MCPRefreshTokenAudienceName is the audience claim for MCP OAuth refresh tokens.
	MCPRefreshTokenAudienceName = "mcp.refresh-token"

	// MCPAccessTokenDuration is the lifetime of MCP access tokens.
	MCPAccessTokenDuration = time.Hour

	// MCPRefreshTokenDuration is the lifetime of MCP refresh tokens.
	MCPRefreshTokenDuration = 90 * 24 * time.Hour

	// MCPScopeRead grants read-only tools.
	MCPScopeRead = "mcp:read"

	// MCPScopeWrite grants document-mutating tools.
	MCPScopeWrite = "mcp:write"
)

// MCPAccessTokenClaims contains claims for MCP OAuth access tokens.
// Validated by signature only (stateless).
type MCPAccessTokenClaims struct {
	Type     string `json:"type"`      // "mcp_access"
	ClientID string `json:"client_id"` // OAuth client the token was issued to
	Scope    string `json:"scope"`     // space-delimited scopes
	Resource string `json:"resource"`  // RFC 8707 resource indicator this token is bound to
	jwt.RegisteredClaims
}

// MCPRefreshTokenClaims contains claims for MCP OAuth refresh tokens.
// Validated against the database so they can be revoked from user settings.
type MCPRefreshTokenClaims struct {
	Type     string `json:"type"`      // "mcp_refresh"
	TokenID  string `json:"tid"`       // Token ID for revocation lookup
	ClientID string `json:"client_id"` // OAuth client the token was issued to
	Scope    string `json:"scope"`     // space-delimited scopes
	Resource string `json:"resource"`  // RFC 8707 resource indicator this token is bound to
	jwt.RegisteredClaims
}

// GenerateMCPAccessToken issues an MCP OAuth access token bound to a resource.
func GenerateMCPAccessToken(userID int32, clientID, scope, resource string, secret []byte) (string, time.Time, error) {
	expiresAt := time.Now().Add(MCPAccessTokenDuration)
	claims := &MCPAccessTokenClaims{
		Type:     "mcp_access",
		ClientID: clientID,
		Scope:    scope,
		Resource: resource,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{MCPAccessTokenAudienceName},
			Subject:   formatUserID(userID),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	tokenString, err := signClaims(claims, secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return tokenString, expiresAt, nil
}

// GenerateMCPRefreshToken issues an MCP OAuth refresh token.
func GenerateMCPRefreshToken(userID int32, tokenID, clientID, scope, resource string, secret []byte) (string, time.Time, error) {
	expiresAt := time.Now().Add(MCPRefreshTokenDuration)
	claims := &MCPRefreshTokenClaims{
		Type:     "mcp_refresh",
		TokenID:  tokenID,
		ClientID: clientID,
		Scope:    scope,
		Resource: resource,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{MCPRefreshTokenAudienceName},
			Subject:   formatUserID(userID),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	tokenString, err := signClaims(claims, secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return tokenString, expiresAt, nil
}

// ParseMCPAccessToken parses and validates an MCP OAuth access token.
//
// resource is the canonical resource identifier of the endpoint doing the
// validation; a token minted for another resource is rejected (RFC 8707), which
// is what stops a token phished by a different MCP server from being replayed here.
func ParseMCPAccessToken(tokenString, resource string, secret []byte) (*MCPAccessTokenClaims, error) {
	claims := &MCPAccessTokenClaims{}
	if _, err := jwt.ParseWithClaims(tokenString, claims, verifyJWTKeyFunc(secret),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(MCPAccessTokenAudienceName),
	); err != nil {
		return nil, err
	}
	if claims.Type != "mcp_access" {
		return nil, errors.New("invalid token type: expected MCP access token")
	}
	if resource != "" && claims.Resource != resource {
		return nil, errors.Errorf("token is bound to a different resource: %q", claims.Resource)
	}
	return claims, nil
}

// ParseMCPRefreshToken parses and validates an MCP OAuth refresh token.
// The caller must additionally check the token ID against the store for revocation.
func ParseMCPRefreshToken(tokenString string, secret []byte) (*MCPRefreshTokenClaims, error) {
	claims := &MCPRefreshTokenClaims{}
	if _, err := jwt.ParseWithClaims(tokenString, claims, verifyJWTKeyFunc(secret),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(MCPRefreshTokenAudienceName),
	); err != nil {
		return nil, err
	}
	if claims.Type != "mcp_refresh" {
		return nil, errors.New("invalid token type: expected MCP refresh token")
	}
	return claims, nil
}

func formatUserID(userID int32) string {
	return strconv.FormatInt(int64(userID), 10)
}

func signClaims(claims jwt.Claims, secret []byte) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = KeyID
	return token.SignedString(secret)
}
