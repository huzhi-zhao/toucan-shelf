package v1

import (
	"context"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// The server is a dumb gate for locked attachments, exactly as attachmentacl's
// package doc for the read side says: it stores and compares an opaque
// HMAC the browser computed from a key it never sees, and never itself derives
// or verifies a passphrase. See
// docs/dev/requirements/attachments/access-control-and-private-files.md, part B.
const (
	vaultUnlockRateLimit  = 5
	vaultUnlockRateWindow = time.Minute
)

// UnlockVault verifies proof of the caller's master key against their stored
// unlock_verifier and, on success, issues an HttpOnly vault cookie scoped to
// this browser session. Failed attempts are rate-limited per user.
func (s *APIV1Service) UnlockVault(ctx context.Context, request *v1pb.UnlockVaultRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	// ADR-0003: the vault only ever unlocks for a browser session. A PAT or MCP
	// caller cannot reach this even with a correct proof.
	if auth.GetCredentialKind(ctx) != auth.CredentialKindSession {
		return nil, status.Errorf(codes.PermissionDenied, "the attachment vault can only be unlocked from a browser session")
	}
	if request.Proof == "" {
		return nil, status.Errorf(codes.InvalidArgument, "proof is required")
	}

	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &user.ID,
		Key:    storepb.UserSetting_SECRET_KEY,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get secret key setting: %v", err)
	}
	secretKey := setting.GetSecretKey()
	if secretKey.GetUnlockVerifier() == "" {
		// R8: a legacy user who set their master passphrase before this field
		// existed has no unlock_verifier yet. They must unlock it once in Settings
		// so the client can backfill it — never treat "missing" as "always wrong".
		return nil, status.Errorf(codes.FailedPrecondition, "unlock your master passphrase once in Settings before using the attachment vault")
	}

	limited, err := vaultUnlockRateLimited(secretKey)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check rate limit: %v", err)
	}
	if limited {
		return nil, status.Errorf(codes.ResourceExhausted, "too many failed unlock attempts; try again in a minute")
	}

	if subtle.ConstantTimeCompare([]byte(request.Proof), []byte(secretKey.GetUnlockVerifier())) != 1 {
		if err := s.recordFailedVaultUnlock(ctx, user.ID, secretKey); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to record failed unlock attempt: %v", err)
		}
		return nil, status.Errorf(codes.PermissionDenied, "incorrect proof")
	}

	if secretKey.GetFailedUnlockAttempts() != 0 {
		if err := s.resetVaultUnlockFailures(ctx, user.ID, secretKey); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to reset unlock failure counter: %v", err)
		}
	}

	token, expiresAt, err := auth.GenerateVaultToken(user.ID, []byte(s.Secret))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate vault token: %v", err)
	}
	if err := SetResponseHeader(ctx, "Set-Cookie", buildVaultCookie(ctx, token, expiresAt)); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set vault cookie: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// LockVault clears the vault cookie, immediately re-locking every locked
// attachment for this browser session.
func (s *APIV1Service) LockVault(ctx context.Context, _ *v1pb.LockVaultRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := SetResponseHeader(ctx, "Set-Cookie", buildVaultCookie(ctx, "", time.Time{})); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to clear vault cookie: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// vaultUnlockRateLimited reports whether the account is currently locked out of
// UnlockVault by its own failure count. A window that has elapsed no longer
// counts against the caller; the next attempt (success or failure) starts a
// fresh one via recordFailedVaultUnlock/resetVaultUnlockFailures.
func vaultUnlockRateLimited(secretKey *storepb.SecretKeyUserSetting) (bool, error) {
	if secretKey.GetFailedUnlockAttempts() < vaultUnlockRateLimit {
		return false, nil
	}
	windowStart := secretKey.GetFailedUnlockWindowStart()
	if windowStart == nil {
		return false, nil
	}
	return time.Since(windowStart.AsTime()) < vaultUnlockRateWindow, nil
}

func (s *APIV1Service) recordFailedVaultUnlock(ctx context.Context, userID int32, secretKey *storepb.SecretKeyUserSetting) error {
	updated, ok := proto.Clone(secretKey).(*storepb.SecretKeyUserSetting)
	if !ok {
		updated = &storepb.SecretKeyUserSetting{}
	}
	now := time.Now()
	windowStart := updated.GetFailedUnlockWindowStart()
	if windowStart == nil || now.Sub(windowStart.AsTime()) >= vaultUnlockRateWindow {
		updated.FailedUnlockAttempts = 0
		updated.FailedUnlockWindowStart = timestamppb.New(now)
	}
	updated.FailedUnlockAttempts++
	return s.upsertSecretKeySetting(ctx, userID, updated)
}

func (s *APIV1Service) resetVaultUnlockFailures(ctx context.Context, userID int32, secretKey *storepb.SecretKeyUserSetting) error {
	updated, ok := proto.Clone(secretKey).(*storepb.SecretKeyUserSetting)
	if !ok {
		updated = &storepb.SecretKeyUserSetting{}
	}
	updated.FailedUnlockAttempts = 0
	updated.FailedUnlockWindowStart = nil
	return s.upsertSecretKeySetting(ctx, userID, updated)
}

func (s *APIV1Service) upsertSecretKeySetting(ctx context.Context, userID int32, secretKey *storepb.SecretKeyUserSetting) error {
	_, err := s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_SECRET_KEY,
		Value:  &storepb.UserSetting_SecretKey{SecretKey: secretKey},
	})
	return err
}

// canLockAttachment reports whether creatorID has an unlock_verifier on file —
// the R8 precondition for setting `locked = true` on any of their attachments.
func (s *APIV1Service) canLockAttachment(ctx context.Context, creatorID int32) (bool, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &creatorID,
		Key:    storepb.UserSetting_SECRET_KEY,
	})
	if err != nil {
		return false, err
	}
	return setting.GetSecretKey().GetUnlockVerifier() != "", nil
}

// buildVaultCookie mirrors APIV1Service.buildRefreshTokenCookie (auth_service.go):
// same attributes, different cookie name and a shorter lifetime.
func buildVaultCookie(ctx context.Context, token string, expireTime time.Time) string {
	attrs := []string{
		fmt.Sprintf("%s=%s", auth.VaultCookieName, token),
		"Path=/",
		"HttpOnly",
	}
	if expireTime.IsZero() {
		attrs = append(attrs, "Expires=Thu, 01 Jan 1970 00:00:00 GMT")
	} else {
		attrs = append(attrs, "Expires="+expireTime.UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT"))
	}
	if isSecureRequest(ctx) {
		attrs = append(attrs, "SameSite=Lax", "Secure")
	} else {
		attrs = append(attrs, "SameSite=Lax")
	}
	return strings.Join(attrs, "; ")
}
