package oauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/pkg/errors"
)

// clientMetadata is the subset of RFC 7591 client metadata this server keeps.
type clientMetadata struct {
	ClientName   string   `json:"client_name,omitempty"`
	RedirectURIs []string `json:"redirect_uris"`
	IssuedAt     int64    `json:"iat"`
}

// Dynamic client registration is stateless: instead of persisting a row per
// registered client, the client's metadata *is* the client_id, HMAC-signed with
// the instance secret. A client_id therefore survives restarts and needs no
// migration, and a forged one cannot be produced without the secret.
//
// The trade-off is that there is no server-side client list and hence no
// per-client revocation. That is acceptable because the client is public (no
// secret), carries no privileges of its own, and every authorization still
// requires an interactive user consent plus PKCE. What the user can revoke is
// the thing that actually grants access — the refresh token, from user settings.
const clientIDPrefix = "mcpc_"

func encodeClientID(metadata *clientMetadata, secret []byte) (string, error) {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return "", errors.Wrap(err, "failed to encode client metadata")
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return clientIDPrefix + encoded + "." + signPayload(encoded, secret), nil
}

func decodeClientID(clientID string, secret []byte) (*clientMetadata, error) {
	if !strings.HasPrefix(clientID, clientIDPrefix) {
		return nil, errors.New("unknown client_id")
	}
	encoded, signature, ok := strings.Cut(strings.TrimPrefix(clientID, clientIDPrefix), ".")
	if !ok {
		return nil, errors.New("malformed client_id")
	}
	if !hmac.Equal([]byte(signature), []byte(signPayload(encoded, secret))) {
		return nil, errors.New("client_id signature mismatch")
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.Wrap(err, "malformed client_id")
	}
	metadata := &clientMetadata{}
	if err := json.Unmarshal(payload, metadata); err != nil {
		return nil, errors.Wrap(err, "malformed client_id")
	}
	return metadata, nil
}

func signPayload(payload string, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// validateRedirectURIs rejects registrations this server would never be able to
// redirect back to safely.
func validateRedirectURIs(redirectURIs []string) error {
	if len(redirectURIs) == 0 {
		return errors.New("redirect_uris must not be empty")
	}
	if len(redirectURIs) > 10 {
		return errors.New("too many redirect_uris")
	}
	for _, redirectURI := range redirectURIs {
		parsed, err := url.Parse(redirectURI)
		if err != nil || parsed.Scheme == "" {
			return errors.Errorf("invalid redirect_uri: %q", redirectURI)
		}
		if parsed.Fragment != "" {
			return errors.Errorf("redirect_uri must not contain a fragment: %q", redirectURI)
		}
		if parsed.Scheme == "https" {
			continue
		}
		// Native clients (Claude Code among them) receive the callback on a
		// loopback listener whose port is only known at runtime, so plain http
		// is allowed there and nowhere else. See RFC 8252 §7.3.
		if parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()) {
			continue
		}
		// A private-use URI scheme ("com.example.app:/callback") is the other
		// shape RFC 8252 blesses for native clients.
		if parsed.Scheme != "http" && parsed.Opaque == "" && strings.Contains(parsed.Scheme, ".") {
			continue
		}
		return errors.Errorf("redirect_uri must use https or a loopback address: %q", redirectURI)
	}
	return nil
}

// matchRedirectURI compares a requested redirect_uri against the registered set.
//
// Matching is exact, with one exception required by RFC 8252 §7.3: for loopback
// addresses the port is ignored, because a native client picks an ephemeral port
// at authorization time that it could not have known at registration time.
func matchRedirectURI(registered []string, requested string) bool {
	requestedURL, err := url.Parse(requested)
	if err != nil {
		return false
	}
	for _, candidate := range registered {
		if candidate == requested {
			return true
		}
		candidateURL, err := url.Parse(candidate)
		if err != nil {
			continue
		}
		if candidateURL.Scheme != "http" || requestedURL.Scheme != "http" {
			continue
		}
		if !isLoopbackHost(candidateURL.Hostname()) || !isLoopbackHost(requestedURL.Hostname()) {
			continue
		}
		if candidateURL.Hostname() == requestedURL.Hostname() && candidateURL.Path == requestedURL.Path {
			return true
		}
	}
	return false
}

func isLoopbackHost(hostname string) bool {
	return hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1"
}
