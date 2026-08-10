package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
)

// sessionCtx builds a context that authenticates as user over a session
// credential and carries a header carrier, so UnlockVault/LockVault can set the
// vault cookie and callers can read it back via apiv1.GetHeaderCarrier.
func sessionCtx(ts *TestService, userID int32) context.Context {
	ctx := apiv1.WithHeaderCarrier(context.Background())
	ctx = ts.CreateUserContext(ctx, userID)
	return auth.SetCredentialKindInContext(ctx, auth.CredentialKindSession)
}

func setUnlockVerifier(t *testing.T, ts *TestService, ctx context.Context, userID int32, verifier string) {
	t.Helper()
	_, err := ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value: &storepb.UserSetting_SecretKey{
			SecretKey: &storepb.SecretKeyUserSetting{
				// Non-empty so validateSecretKeySetting's "unconfigured" shortcut
				// doesn't apply — this simulates a user who already has a wrapped
				// master key, only the unlock_verifier is what's under test.
				Kdf:            "master-v1",
				Cipher:         "aes-256-gcm",
				Salt:           "c2FsdA==",
				Nonce:          "bm9uY2U=",
				Verifier:       "dmVyaWZpZXI=",
				WrappedKey:     "d3JhcHBlZA==",
				UnlockVerifier: verifier,
			},
		},
	})
	require.NoError(t, err)
}

func TestUnlockVault_RequiresUnlockVerifier(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "vault-no-verifier")
	require.NoError(t, err)

	_, err = ts.Service.UnlockVault(sessionCtx(ts, user.ID), &v1pb.UnlockVaultRequest{Proof: "anything"})
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestUnlockVault_WrongProofDenied(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "vault-wrong-proof")
	require.NoError(t, err)
	setUnlockVerifier(t, ts, ctx, user.ID, "correct-verifier")

	_, err = ts.Service.UnlockVault(sessionCtx(ts, user.ID), &v1pb.UnlockVaultRequest{Proof: "wrong-verifier"})
	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
}

func TestUnlockVault_CorrectProofSetsCookieAndLockClearsIt(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "vault-correct-proof")
	require.NoError(t, err)
	setUnlockVerifier(t, ts, ctx, user.ID, "correct-verifier")

	unlockCtx := sessionCtx(ts, user.ID)
	_, err = ts.Service.UnlockVault(unlockCtx, &v1pb.UnlockVaultRequest{Proof: "correct-verifier"})
	require.NoError(t, err)
	cookie := apiv1.GetHeaderCarrier(unlockCtx).Get("Set-Cookie")
	assert.Contains(t, cookie, auth.VaultCookieName+"=")
	assert.Contains(t, cookie, "HttpOnly")
	assert.NotContains(t, cookie, "Expires=Thu, 01 Jan 1970")

	lockCtx := sessionCtx(ts, user.ID)
	_, err = ts.Service.LockVault(lockCtx, &v1pb.LockVaultRequest{})
	require.NoError(t, err)
	clearCookie := apiv1.GetHeaderCarrier(lockCtx).Get("Set-Cookie")
	assert.Contains(t, clearCookie, "Expires=Thu, 01 Jan 1970")
}

func TestUnlockVault_RequiresSessionCredential(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "vault-pat-credential")
	require.NoError(t, err)
	setUnlockVerifier(t, ts, ctx, user.ID, "correct-verifier")

	patCtx := apiv1.WithHeaderCarrier(ts.CreateUserContext(context.Background(), user.ID))
	patCtx = auth.SetCredentialKindInContext(patCtx, auth.CredentialKindPAT)
	_, err = ts.Service.UnlockVault(patCtx, &v1pb.UnlockVaultRequest{Proof: "correct-verifier"})
	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))
}

func TestUnlockVault_RateLimitedAfterFiveFailures(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "vault-rate-limited")
	require.NoError(t, err)
	setUnlockVerifier(t, ts, ctx, user.ID, "correct-verifier")

	for i := 0; i < 5; i++ {
		_, err := ts.Service.UnlockVault(sessionCtx(ts, user.ID), &v1pb.UnlockVaultRequest{Proof: "wrong"})
		require.Error(t, err)
		assert.Equal(t, codes.PermissionDenied, status.Code(err))
	}

	// The 6th attempt is rate-limited even with the correct proof: the limiter
	// gates on the failure count, checked before the proof comparison.
	_, err = ts.Service.UnlockVault(sessionCtx(ts, user.ID), &v1pb.UnlockVaultRequest{Proof: "correct-verifier"})
	require.Error(t, err)
	assert.Equal(t, codes.ResourceExhausted, status.Code(err))
}

func TestUpdateAttachment_LockingRequiresUnlockVerifier(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "lock-toggle-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "secret.txt", Type: "text/plain", Content: []byte("shh")},
	})
	require.NoError(t, err)

	lockedMask := &fieldmaskpb.FieldMask{Paths: []string{"locked"}}
	_, err = ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Locked: true},
		UpdateMask: lockedMask,
	})
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))

	setUnlockVerifier(t, ts, ctx, user.ID, "correct-verifier")

	updated, err := ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Locked: true},
		UpdateMask: lockedMask,
	})
	require.NoError(t, err)
	assert.True(t, updated.Locked)

	// A locked attachment is unreadable to its own creator without a vault
	// unlock, even immediately after they locked it themselves.
	_, err = ts.Service.GetAttachment(userCtx, &v1pb.GetAttachmentRequest{Name: attachment.Name})
	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, status.Code(err))

	unlocked := sessionCtx(ts, user.ID)
	_, err = ts.Service.UnlockVault(unlocked, &v1pb.UnlockVaultRequest{Proof: "correct-verifier"})
	require.NoError(t, err)
	cookie := apiv1.GetHeaderCarrier(unlocked).Get("Set-Cookie")

	readCtx := metadata.NewIncomingContext(sessionCtx(ts, user.ID), metadata.Pairs("cookie", cookie))
	_, err = ts.Service.GetAttachment(readCtx, &v1pb.GetAttachmentRequest{Name: attachment.Name})
	require.NoError(t, err)
}
