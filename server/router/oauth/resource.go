package oauth

import (
	"net/http"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// AuthorizeMCPRequest validates the credentials on a request to /mcp.
//
// It returns the Authorization header the MCP endpoint should use for its
// internal API call. Two credential shapes are accepted:
//
//   - An OAuth access token issued here. It is exchanged for a fresh short-lived
//     API access token, because the MCP token's audience is deliberately not
//     honoured by the API interceptors — that is what keeps it useless anywhere
//     except this endpoint.
//   - A personal access token, forwarded untouched. This is the pre-OAuth setup
//     documented in the manual and keeps working.
func (s *Service) AuthorizeMCPRequest(request *http.Request) (string, string, error) {
	token := auth.ExtractBearerToken(request.Header.Get("Authorization"))
	if token == "" {
		return "", "", errors.New("missing bearer token")
	}
	if strings.HasPrefix(token, auth.PersonalAccessTokenPrefix) {
		return request.Header.Get("Authorization"), "", nil
	}

	claims, err := auth.ParseMCPAccessToken(token, s.ResourceIdentifier(request), []byte(s.secret))
	if err != nil {
		return "", "", errors.Wrap(err, "invalid access token")
	}
	userID, err := util.ConvertStringToInt32(claims.Subject)
	if err != nil {
		return "", "", errors.New("invalid access token subject")
	}

	ctx := request.Context()
	user, err := s.store.GetUser(ctx, &store.FindUser{ID: &userID})
	if err != nil || user == nil {
		return "", "", errors.New("user not found")
	}
	if user.RowStatus == store.Archived {
		return "", "", errors.New("user is archived")
	}

	apiToken, _, err := auth.GenerateAccessTokenV2(
		user.ID,
		user.Username,
		string(user.Role),
		string(user.RowStatus),
		[]byte(s.secret),
	)
	if err != nil {
		return "", "", errors.Wrap(err, "failed to mint an internal access token")
	}
	return "Bearer " + apiToken, claims.Scope, nil
}

// ResourceMetadataURL is the RFC 9728 document advertised to unauthenticated callers.
func (s *Service) ResourceMetadataURL(request *http.Request) string {
	return s.BaseURL(request) + "/.well-known/oauth-protected-resource"
}
