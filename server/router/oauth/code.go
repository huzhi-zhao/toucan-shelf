package oauth

import (
	"crypto/sha256"
	"encoding/base64"
	"sync"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/util"
)

// authorizationCodeTTL is deliberately short. RFC 6749 recommends a maximum of
// ten minutes; the code only has to survive one redirect hop.
const authorizationCodeTTL = 5 * time.Minute

type authorizationCode struct {
	UserID              int32
	ClientID            string
	RedirectURI         string
	Scope               string
	Resource            string
	CodeChallenge       string
	CodeChallengeMethod string
	ExpiresAt           time.Time
}

// codeStore holds pending authorization codes in memory.
//
// In-memory is the right shape here: memos runs as a single process, a code is
// valid for five minutes and is consumed exactly once, and losing pending codes
// on restart only means the user clicks "authorize" again. Persisting them would
// cost a table in three database drivers to buy nothing.
type codeStore struct {
	mu    sync.Mutex
	codes map[string]*authorizationCode
}

func newCodeStore() *codeStore {
	return &codeStore{codes: map[string]*authorizationCode{}}
}

func (s *codeStore) issue(code *authorizationCode) (string, error) {
	value, err := util.RandomString(48)
	if err != nil {
		return "", errors.Wrap(err, "failed to generate authorization code")
	}
	code.ExpiresAt = time.Now().Add(authorizationCodeTTL)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.evictExpiredLocked()
	s.codes[value] = code
	return value, nil
}

// consume returns the code's record and deletes it, so a replayed code fails.
func (s *codeStore) consume(value string) (*authorizationCode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	code, ok := s.codes[value]
	if !ok {
		return nil, errors.New("invalid authorization code")
	}
	delete(s.codes, value)
	if time.Now().After(code.ExpiresAt) {
		return nil, errors.New("authorization code expired")
	}
	return code, nil
}

func (s *codeStore) evictExpiredLocked() {
	now := time.Now()
	for value, code := range s.codes {
		if now.After(code.ExpiresAt) {
			delete(s.codes, value)
		}
	}
}

// verifyPKCE checks a code_verifier against the stored challenge.
// Only S256 is accepted: "plain" gives no protection to a public client.
func verifyPKCE(challenge, method, verifier string) error {
	if challenge == "" {
		return errors.New("authorization was issued without PKCE")
	}
	if method != "S256" {
		return errors.Errorf("unsupported code_challenge_method: %q", method)
	}
	if len(verifier) < 43 || len(verifier) > 128 {
		return errors.New("invalid code_verifier length")
	}
	sum := sha256.Sum256([]byte(verifier))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
		return errors.New("code_verifier does not match code_challenge")
	}
	return nil
}
