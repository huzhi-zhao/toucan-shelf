package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func newTestingSecretBlock(uid string, creatorID int32) *store.SecretBlock {
	return &store.SecretBlock{
		UID:           uid,
		CreatorID:     creatorID,
		Hint:          "minio-prod",
		KDF:           "pbkdf2-sha256",
		KDFIterations: 600000,
		Cipher:        "aes-256-gcm",
		Salt:          "c2FsdHNhbHRzYWx0c2FsdA==",
		Nonce:         "bm9uY2Vub25jZTEy",
		Verifier:      "dmVyaWZpZXJ2ZXJpZmllcnZlcmlmaWVydmVyaWY=",
		Ciphertext:    "Y2lwaGVydGV4dC1ieXRlcy1oZXJl",
	}
}

func TestSecretBlockStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	create := newTestingSecretBlock("sb-first", user.ID)
	created, err := ts.CreateSecretBlock(ctx, create)
	require.NoError(t, err)
	require.NotZero(t, created.ID)
	require.NotZero(t, created.CreatedTs)
	require.NotZero(t, created.UpdatedTs)
	require.Equal(t, "minio-prod", created.Hint)
	require.Equal(t, int32(600000), created.KDFIterations)

	uid := created.UID
	got, err := ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, create.Ciphertext, got.Ciphertext)
	require.Equal(t, create.Salt, got.Salt)
	require.Equal(t, create.Nonce, got.Nonce)
	require.Equal(t, create.Verifier, got.Verifier)

	// A missing record is a nil result, not an error.
	missing := "sb-does-not-exist"
	got, err = ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &missing, CreatorID: &user.ID})
	require.NoError(t, err)
	require.Nil(t, got)

	// The store never returns another user's record, even given the right uid.
	otherUser, err := createTestingUserWithRole(ctx, ts, "other-user", store.RoleUser)
	require.NoError(t, err)
	got, err = ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &otherUser.ID})
	require.NoError(t, err)
	require.Nil(t, got)
}

// Replacing an envelope in place is the whole reason ciphertext lives in its own
// table: no superseded copy may survive a passphrase change.
func TestSecretBlockStoreUpdateReplacesEnvelope(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	created, err := ts.CreateSecretBlock(ctx, newTestingSecretBlock("sb-rotate", user.ID))
	require.NoError(t, err)

	updated, err := ts.UpdateSecretBlock(ctx, &store.UpdateSecretBlock{
		UID:           created.UID,
		CreatorID:     user.ID,
		Hint:          "minio-prod (rotated)",
		KDF:           "pbkdf2-sha256",
		KDFIterations: 700000,
		Cipher:        "aes-256-gcm",
		Salt:          "bmV3c2FsdG5ld3NhbHRuZXc=",
		Nonce:         "bmV3bm9uY2UxMjM0",
		Verifier:      "bmV3dmVyaWZpZXJuZXd2ZXJpZmllcm5ld3Zlcmlm",
		Ciphertext:    "bmV3LWNpcGhlcnRleHQtYnl0ZXM=",
	})
	require.NoError(t, err)
	require.NotNil(t, updated)
	require.Equal(t, "minio-prod (rotated)", updated.Hint)
	require.Equal(t, int32(700000), updated.KDFIterations)
	require.Equal(t, "bmV3LWNpcGhlcnRleHQtYnl0ZXM=", updated.Ciphertext)
	require.Equal(t, created.ID, updated.ID, "update must replace in place, not insert a new row")

	uid := created.UID
	got, err := ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.NotEqual(t, created.Ciphertext, got.Ciphertext, "the old ciphertext must not survive")

	// Another user cannot overwrite someone else's record.
	otherUser, err := createTestingUserWithRole(ctx, ts, "other-user", store.RoleUser)
	require.NoError(t, err)
	hijacked, err := ts.UpdateSecretBlock(ctx, &store.UpdateSecretBlock{
		UID:           created.UID,
		CreatorID:     otherUser.ID,
		Hint:          "hijacked",
		KDF:           "pbkdf2-sha256",
		KDFIterations: 600000,
		Cipher:        "aes-256-gcm",
		Salt:          "c2FsdHNhbHRzYWx0c2FsdA==",
		Nonce:         "bm9uY2Vub25jZTEy",
		Verifier:      "dmVyaWZpZXJ2ZXJpZmllcnZlcmlmaWVydmVyaWY=",
		Ciphertext:    "aGlqYWNrZWQ=",
	})
	require.NoError(t, err)
	require.Nil(t, hijacked)

	got, err = ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.Equal(t, "minio-prod (rotated)", got.Hint)
}

func TestSecretBlockStoreListSummariesOmitsCiphertext(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	first := newTestingSecretBlock("sb-list-1", user.ID)
	_, err = ts.CreateSecretBlock(ctx, first)
	require.NoError(t, err)
	second := newTestingSecretBlock("sb-list-2", user.ID)
	second.Hint = "aws-staging"
	_, err = ts.CreateSecretBlock(ctx, second)
	require.NoError(t, err)

	summaries, err := ts.ListSecretBlockSummaries(ctx, &store.FindSecretBlock{CreatorID: &user.ID})
	require.NoError(t, err)
	require.Len(t, summaries, 2)
	// Newest first.
	require.Equal(t, "sb-list-2", summaries[0].UID)
	require.Equal(t, "aws-staging", summaries[0].Hint)
	require.Equal(t, int64(len(first.Ciphertext)), summaries[1].CiphertextSize)

	// Another user's listing is empty, not a leak.
	otherUser, err := createTestingUserWithRole(ctx, ts, "other-user", store.RoleUser)
	require.NoError(t, err)
	summaries, err = ts.ListSecretBlockSummaries(ctx, &store.FindSecretBlock{CreatorID: &otherUser.ID})
	require.NoError(t, err)
	require.Empty(t, summaries)
}

// Secret records belong to their creator, not to any document, so nothing about a
// memo's lifecycle may destroy one. Only a deliberate delete does.
func TestSecretBlockStoreDelete(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	created, err := ts.CreateSecretBlock(ctx, newTestingSecretBlock("sb-delete", user.ID))
	require.NoError(t, err)
	uid := created.UID

	// Another user's delete is a no-op rather than a silent destruction.
	otherUser, err := createTestingUserWithRole(ctx, ts, "other-user", store.RoleUser)
	require.NoError(t, err)
	require.NoError(t, ts.DeleteSecretBlock(ctx, &store.DeleteSecretBlock{UID: uid, CreatorID: otherUser.ID}))
	got, err := ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, got)

	require.NoError(t, ts.DeleteSecretBlock(ctx, &store.DeleteSecretBlock{UID: uid, CreatorID: user.ID}))
	got, err = ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.Nil(t, got)
}

// Deleting the memo that references a secret must leave the secret alone. This is
// the guarantee that makes "永不自动删除" safe to rely on, and the reason the table
// has no memo_id foreign key.
func TestSecretBlockStoreSurvivesReferencingMemoDeletion(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	created, err := ts.CreateSecretBlock(ctx, newTestingSecretBlock("sb-outlives-memo", user.ID))
	require.NoError(t, err)

	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID:        "memo-referencing-secret",
		CreatorID:  user.ID,
		Content:    "```toucan-secret\nv: 1\nid: " + created.UID + "\n```",
		Visibility: store.Private,
	})
	require.NoError(t, err)
	require.NoError(t, ts.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID}))

	uid := created.UID
	got, err := ts.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, got, "deleting a document must never destroy the secrets it referenced")
	require.Equal(t, created.Ciphertext, got.Ciphertext)
}
