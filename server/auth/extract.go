package auth

import (
	"fmt"
	"net/http"
	"strings"
)

// ExtractBearerToken extracts the JWT token from an Authorization header value.
// Expected format: "Bearer {token}"
// Returns empty string if no valid bearer token is found.
func ExtractBearerToken(authHeader string) string {
	if authHeader == "" {
		return ""
	}
	parts := strings.Fields(authHeader)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return parts[1]
}

// ExtractRefreshTokenFromCookie extracts the refresh token from cookie header.
func ExtractRefreshTokenFromCookie(cookieHeader string) string {
	if cookieHeader == "" {
		return ""
	}
	req := &http.Request{Header: http.Header{"Cookie": []string{cookieHeader}}}
	cookie, err := req.Cookie(RefreshTokenCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// ExtractVaultTokenFromCookie extracts the attachment-vault unlock token from a
// cookie header.
func ExtractVaultTokenFromCookie(cookieHeader string) string {
	if cookieHeader == "" {
		return ""
	}
	req := &http.Request{Header: http.Header{"Cookie": []string{cookieHeader}}}
	cookie, err := req.Cookie(VaultCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// VaultUnlocked reports whether cookieHeader carries a valid, unexpired vault
// token for userID, and whether the request that carried it authenticated over
// a browser session. PAT and MCP credentials are never honored for vault
// access, even if one somehow carries the cookie (ADR-0003) — a locked
// attachment's whole point is that a leaked token doesn't reach it.
func VaultUnlocked(cookieHeader string, secret []byte, userID int32, credentialKind CredentialKind) bool {
	if credentialKind != CredentialKindSession {
		return false
	}
	token := ExtractVaultTokenFromCookie(cookieHeader)
	if token == "" {
		return false
	}
	claims, err := ParseVaultToken(token, secret)
	if err != nil {
		return false
	}
	return claims.Subject == fmt.Sprint(userID)
}

// VaultUnlocked is the Authenticator-bound form of the package-level
// VaultUnlocked, for callers (the file server) that hold an Authenticator
// rather than the raw instance secret.
func (a *Authenticator) VaultUnlocked(cookieHeader string, userID int32, credentialKind CredentialKind) bool {
	return VaultUnlocked(cookieHeader, []byte(a.secret), userID, credentialKind)
}
