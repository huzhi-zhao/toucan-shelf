package store

import "context"

// SecretBlock is the client-encrypted payload behind a `toucan-secret` fenced
// block. Every cryptographic field is opaque here: encryption and decryption
// happen in the browser, and the server holds neither plaintext nor passphrase.
//
// A secret block belongs to its creator, not to the document that references it.
// Documents point at one by UID from their markdown body, and a record outlives
// the documents referencing it — see docs/dev/requirements/editor/secret-block.md.
type SecretBlock struct {
	ID        int32
	UID       string
	CreatorID int32

	// Hint is a user-authored label for which passphrase unlocks this block. It is
	// stored and displayed in clear text: a reminder, not a secret.
	Hint string

	// KDF, KDFIterations and Cipher record the suite this record was written with,
	// so a future suite can be introduced without migrating existing records.
	KDF           string
	KDFIterations int32
	Cipher        string

	// Base64 fields, all produced by the client.
	Salt       string
	Nonce      string
	Verifier   string
	Ciphertext string

	CreatedTs int64
	UpdatedTs int64

	// Policy is the JSON time-gate policy of a restricted block, or "" for an
	// ordinary one. The store treats it as opaque; its meaning lives in the API
	// layer. See docs/dev/requirements/editor/restricted-secret-block.md.
	Policy string
	// PendingPolicy and PendingPolicyEffectiveTs describe a scheduled policy
	// change. A zero effective time means nothing is scheduled; a non-zero one
	// with an empty PendingPolicy lifts the restriction.
	PendingPolicy            string
	PendingPolicyEffectiveTs int64
}

// SecretBlockSummary is a secret block without its envelope.
//
// It exists as a distinct type rather than a partially-populated SecretBlock so
// that listing cannot start returning ciphertext by accident: the list query does
// not select those columns at all. Bulk-shipping ciphertext to a management screen
// that only needs labels would hand out a ready-made offline brute-force corpus.
type SecretBlockSummary struct {
	ID   int32
	UID  string
	Hint string

	// CiphertextSize is the length of the stored base64 ciphertext, so a management
	// screen can show a size without transferring the ciphertext.
	CiphertextSize int64

	CreatedTs int64
	UpdatedTs int64

	// Restriction state, as on SecretBlock. Not part of the envelope, so listing
	// may carry it.
	Policy                   string
	PendingPolicy            string
	PendingPolicyEffectiveTs int64
}

// FindSecretBlock filters secret block queries. CreatorID is not optional in
// practice — every caller scopes to the authenticated user.
type FindSecretBlock struct {
	UID       *string
	CreatorID *int32
}

// UpdateSecretBlock replaces a record's hint and envelope wholesale. There is no
// partial update: a half-updated envelope would be permanently undecryptable.
//
// Replacing in place (rather than appending a new record) is the reason ciphertext
// lives in this table instead of inline in the document body. An inline envelope
// would be copied into memo_history on every edit and pushed into git by memogit,
// both of which are append-only — so re-encrypting under a new passphrase would
// leave the old passphrase's ciphertext readable forever, making a passphrase
// change useless.
type UpdateSecretBlock struct {
	UID           string
	CreatorID     int32
	Hint          string
	KDF           string
	KDFIterations int32
	Cipher        string
	Salt          string
	Nonce         string
	Verifier      string
	Ciphertext    string
}

// UpdateSecretBlockPolicy writes a block's restriction columns. It is the only
// path that touches them: UpdateSecretBlock replaces the envelope and never the
// policy, so replacing a restricted secret's content cannot loosen its gate.
type UpdateSecretBlockPolicy struct {
	ID                       int32
	Policy                   string
	PendingPolicy            string
	PendingPolicyEffectiveTs int64
}

// Kinds of SecretBlockUnlock.
const (
	SecretBlockUnlockNormal    = "normal"
	SecretBlockUnlockEmergency = "emergency"
)

// SecretBlockUnlock is one request to open a restricted block. Rows outlive the
// request: the emergency quota is counted from them, and the latest emergency
// row is shown on the block afterwards.
type SecretBlockUnlock struct {
	ID            int32
	SecretBlockID int32
	Kind          string
	// Reason is the owner's stated reason for an emergency unlock.
	Reason      string
	RequestedTs int64
	AvailableTs int64
	// OpenedTs and ExpiresTs are zero until the envelope is first served.
	OpenedTs  int64
	ExpiresTs int64
	// CanceledTs is zero unless the owner withdrew the request while it waited.
	CanceledTs int64
}

// FindSecretBlockUnlock filters unlock requests of one block, newest first.
type FindSecretBlockUnlock struct {
	SecretBlockID int32
	Kind          *string
	// RequestedAfterTs keeps rows with requested_ts > this value.
	RequestedAfterTs *int64
	Limit            int
}

// DeleteSecretBlock identifies a record to destroy permanently. Only a deliberate
// user action reaches here; document deletion never does.
type DeleteSecretBlock struct {
	UID       string
	CreatorID int32
}

// CreateSecretBlock stores a new client-encrypted envelope.
func (s *Store) CreateSecretBlock(ctx context.Context, create *SecretBlock) (*SecretBlock, error) {
	return s.driver.CreateSecretBlock(ctx, create)
}

// GetSecretBlock returns the record matching the filter, or nil if none found.
func (s *Store) GetSecretBlock(ctx context.Context, find *FindSecretBlock) (*SecretBlock, error) {
	return s.driver.GetSecretBlock(ctx, find)
}

// ListSecretBlockSummaries returns matching records as metadata only, newest first.
func (s *Store) ListSecretBlockSummaries(ctx context.Context, find *FindSecretBlock) ([]*SecretBlockSummary, error) {
	return s.driver.ListSecretBlockSummaries(ctx, find)
}

// UpdateSecretBlock replaces a record's hint and envelope, returning the updated
// record, or nil if no record matched.
func (s *Store) UpdateSecretBlock(ctx context.Context, update *UpdateSecretBlock) (*SecretBlock, error) {
	return s.driver.UpdateSecretBlock(ctx, update)
}

// DeleteSecretBlock permanently destroys a record. There is no recovery.
func (s *Store) DeleteSecretBlock(ctx context.Context, delete *DeleteSecretBlock) error {
	return s.driver.DeleteSecretBlock(ctx, delete)
}

// UpdateSecretBlockPolicy writes a block's restriction columns.
func (s *Store) UpdateSecretBlockPolicy(ctx context.Context, update *UpdateSecretBlockPolicy) error {
	return s.driver.UpdateSecretBlockPolicy(ctx, update)
}

// CreateSecretBlockUnlock records a new unlock request.
func (s *Store) CreateSecretBlockUnlock(ctx context.Context, create *SecretBlockUnlock) (*SecretBlockUnlock, error) {
	return s.driver.CreateSecretBlockUnlock(ctx, create)
}

// ListSecretBlockUnlocks returns a block's unlock requests, newest first.
func (s *Store) ListSecretBlockUnlocks(ctx context.Context, find *FindSecretBlockUnlock) ([]*SecretBlockUnlock, error) {
	return s.driver.ListSecretBlockUnlocks(ctx, find)
}

// OpenSecretBlockUnlock starts the viewing window of a request that has not been
// opened yet. It reports false when the request was already opened (or does not
// exist), so two concurrent first fetches cannot both restart the window.
func (s *Store) OpenSecretBlockUnlock(ctx context.Context, id int32, openedTs, expiresTs int64) (bool, error) {
	return s.driver.OpenSecretBlockUnlock(ctx, id, openedTs, expiresTs)
}

// CancelSecretBlockUnlock marks a request withdrawn.
func (s *Store) CancelSecretBlockUnlock(ctx context.Context, id int32, canceledTs int64) error {
	return s.driver.CancelSecretBlockUnlock(ctx, id, canceledTs)
}
