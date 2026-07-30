package v1

import (
	"context"
	"strings"
	"time"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// The server is a dumb vault for secret blocks: it stores and returns opaque
// envelopes produced by the browser, and holds neither plaintext nor passphrase.
// Nothing in this file may grow the ability to decrypt.

const secretBlockNamePrefix = "secretBlocks/"

// Supported suite names. The server does not implement either algorithm — it
// checks them so a malformed or downgraded envelope is rejected at write time
// rather than discovered when a user can no longer open their own secret.
const (
	secretKDFPBKDF2SHA256 = "pbkdf2-sha256"
	secretCipherAES256GCM = "aes-256-gcm"
)

// Mirrors the client's floor (web/src/utils/secret-crypto.ts). The KDF cost is the
// only thing protecting a leaked database, so a weakened envelope is refused
// storage instead of being kept and honored later.
const (
	secretMinKDFIterations = 100_000
	secretMaxKDFIterations = 10_000_000
)

// Generous caps that reject junk without constraining real use. A secret block
// holds credentials, not documents.
const (
	secretMaxHintLength       = 256
	secretMaxCiphertextLength = 64 * 1024
	secretMaxSaltLength       = 256
)

func secretBlockName(uid string) string {
	return secretBlockNamePrefix + uid
}

func extractSecretBlockUID(name string) (string, error) {
	uid := strings.TrimPrefix(name, secretBlockNamePrefix)
	if uid == name || uid == "" || strings.Contains(uid, "/") {
		return "", status.Errorf(codes.InvalidArgument, "invalid secret block name: %s", name)
	}
	return uid, nil
}

func convertSecretBlockFromStore(sb *store.SecretBlock) *v1pb.SecretBlock {
	return &v1pb.SecretBlock{
		Name: secretBlockName(sb.UID),
		Hint: sb.Hint,
		Envelope: &v1pb.SecretEnvelope{
			Kdf:           sb.KDF,
			KdfIterations: sb.KDFIterations,
			Cipher:        sb.Cipher,
			Salt:          sb.Salt,
			Nonce:         sb.Nonce,
			Verifier:      sb.Verifier,
			Ciphertext:    sb.Ciphertext,
		},
		CreateTime: timestamppb.New(time.Unix(sb.CreatedTs, 0)),
		UpdateTime: timestamppb.New(time.Unix(sb.UpdatedTs, 0)),
	}
}

// validateSecretEnvelope rejects envelopes the client could never decrypt, and
// envelopes weakened below the supported KDF cost.
func validateSecretEnvelope(envelope *v1pb.SecretEnvelope) error {
	if envelope == nil {
		return status.Errorf(codes.InvalidArgument, "envelope is required")
	}
	if envelope.Kdf != secretKDFPBKDF2SHA256 {
		return status.Errorf(codes.InvalidArgument, "unsupported kdf: %s", envelope.Kdf)
	}
	if envelope.Cipher != secretCipherAES256GCM {
		return status.Errorf(codes.InvalidArgument, "unsupported cipher: %s", envelope.Cipher)
	}
	if envelope.KdfIterations < secretMinKDFIterations || envelope.KdfIterations > secretMaxKDFIterations {
		return status.Errorf(codes.InvalidArgument, "kdf iterations out of range: %d", envelope.KdfIterations)
	}
	for field, value := range map[string]string{"salt": envelope.Salt, "nonce": envelope.Nonce, "verifier": envelope.Verifier} {
		if value == "" {
			return status.Errorf(codes.InvalidArgument, "%s is required", field)
		}
		if len(value) > secretMaxSaltLength {
			return status.Errorf(codes.InvalidArgument, "%s is too long", field)
		}
	}
	if envelope.Ciphertext == "" {
		return status.Errorf(codes.InvalidArgument, "ciphertext is required")
	}
	if len(envelope.Ciphertext) > secretMaxCiphertextLength {
		return status.Errorf(codes.InvalidArgument, "ciphertext is too long")
	}
	return nil
}

func validateSecretHint(hint string) error {
	if len(hint) > secretMaxHintLength {
		return status.Errorf(codes.InvalidArgument, "hint is too long")
	}
	return nil
}

func (s *APIV1Service) ListSecretBlocks(ctx context.Context, _ *v1pb.ListSecretBlocksRequest) (*v1pb.ListSecretBlocksResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}

	// Summaries only: this path never selects ciphertext from the database.
	summaries, err := s.Store.ListSecretBlockSummaries(ctx, &store.FindSecretBlock{CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list secret blocks: %v", err)
	}

	response := &v1pb.ListSecretBlocksResponse{SecretBlocks: []*v1pb.SecretBlockSummary{}}
	for _, summary := range summaries {
		response.SecretBlocks = append(response.SecretBlocks, &v1pb.SecretBlockSummary{
			Name:           secretBlockName(summary.UID),
			Hint:           summary.Hint,
			CiphertextSize: summary.CiphertextSize,
			CreateTime:     timestamppb.New(time.Unix(summary.CreatedTs, 0)),
			UpdateTime:     timestamppb.New(time.Unix(summary.UpdatedTs, 0)),
		})
	}
	return response, nil
}

func (s *APIV1Service) GetSecretBlock(ctx context.Context, request *v1pb.GetSecretBlockRequest) (*v1pb.SecretBlock, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	uid, err := extractSecretBlockUID(request.Name)
	if err != nil {
		return nil, err
	}

	// Scoped by creator in the query, so another user's uid simply finds nothing.
	// Responses already carry Cache-Control: no-store from MetadataInterceptor.
	sb, err := s.Store.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get secret block: %v", err)
	}
	if sb == nil {
		return nil, status.Errorf(codes.NotFound, "secret block not found")
	}

	return convertSecretBlockFromStore(sb), nil
}

func (s *APIV1Service) CreateSecretBlock(ctx context.Context, request *v1pb.CreateSecretBlockRequest) (*v1pb.SecretBlock, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	if request.SecretBlock == nil {
		return nil, status.Errorf(codes.InvalidArgument, "secret_block is required")
	}
	if err := validateSecretHint(request.SecretBlock.Hint); err != nil {
		return nil, err
	}
	envelope := request.SecretBlock.Envelope
	if err := validateSecretEnvelope(envelope); err != nil {
		return nil, err
	}

	created, err := s.Store.CreateSecretBlock(ctx, &store.SecretBlock{
		UID:           shortuuid.New(),
		CreatorID:     user.ID,
		Hint:          request.SecretBlock.Hint,
		KDF:           envelope.Kdf,
		KDFIterations: envelope.KdfIterations,
		Cipher:        envelope.Cipher,
		Salt:          envelope.Salt,
		Nonce:         envelope.Nonce,
		Verifier:      envelope.Verifier,
		Ciphertext:    envelope.Ciphertext,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create secret block: %v", err)
	}
	return convertSecretBlockFromStore(created), nil
}

func (s *APIV1Service) UpdateSecretBlock(ctx context.Context, request *v1pb.UpdateSecretBlockRequest) (*v1pb.SecretBlock, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	if request.SecretBlock == nil {
		return nil, status.Errorf(codes.InvalidArgument, "secret_block is required")
	}
	uid, err := extractSecretBlockUID(request.SecretBlock.Name)
	if err != nil {
		return nil, err
	}
	if err := validateSecretHint(request.SecretBlock.Hint); err != nil {
		return nil, err
	}
	envelope := request.SecretBlock.Envelope
	if err := validateSecretEnvelope(envelope); err != nil {
		return nil, err
	}

	// Whole-envelope replacement, no field mask: a partially updated envelope
	// would be permanently undecryptable.
	updated, err := s.Store.UpdateSecretBlock(ctx, &store.UpdateSecretBlock{
		UID:           uid,
		CreatorID:     user.ID,
		Hint:          request.SecretBlock.Hint,
		KDF:           envelope.Kdf,
		KDFIterations: envelope.KdfIterations,
		Cipher:        envelope.Cipher,
		Salt:          envelope.Salt,
		Nonce:         envelope.Nonce,
		Verifier:      envelope.Verifier,
		Ciphertext:    envelope.Ciphertext,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update secret block: %v", err)
	}
	if updated == nil {
		return nil, status.Errorf(codes.NotFound, "secret block not found")
	}
	return convertSecretBlockFromStore(updated), nil
}

func (s *APIV1Service) DeleteSecretBlock(ctx context.Context, request *v1pb.DeleteSecretBlockRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	uid, err := extractSecretBlockUID(request.Name)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeleteSecretBlock(ctx, &store.DeleteSecretBlock{UID: uid, CreatorID: user.ID}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete secret block: %v", err)
	}
	return &emptypb.Empty{}, nil
}
