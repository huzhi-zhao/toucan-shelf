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
	// secretKDFMasterV1 marks a block encrypted against the user's master key
	// rather than a passphrase typed at the block. No passphrase stretching
	// happens for these records — that cost was already paid once when the master
	// key was unwrapped — so they carry no iteration count.
	secretKDFMasterV1     = "master-v1"
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
	if envelope.Cipher != secretCipherAES256GCM {
		return status.Errorf(codes.InvalidArgument, "unsupported cipher: %s", envelope.Cipher)
	}
	// The iteration count is checked against the suite that declared it. Reading it
	// suite-blind would let a "master-v1" label smuggle a weakened pbkdf2 record
	// past this check, or reject a legitimate master record for carrying no count.
	switch envelope.Kdf {
	// LEGACY-COMPAT(secret-block/per-block-passphrase)
	// 这个分支同时服务两种记录，删除条件不一样，别一刀切：
	//   (a) 2026-08-02 之前写的、一块一口令的旧 secret_block 行 —— 属于兼容代码，等
	//       所有旧行都被前端的"改用主口令"迁移成 master-v1 之后才能连同它们一起清理；
	//   (b) user_setting 里包主密钥的信封（见 validateSecretKeySetting）—— 永久使用，
	//       删掉会让所有人都存不了/换不了主口令。
	// 删 (a) 之前先确认库里没有旧行：
	//   SELECT COUNT(*) FROM secret_block WHERE kdf = 'pbkdf2-sha256';
	// 计数不为零就还有用户的密文只能靠它读出来，删了那些数据就永久打不开了。
	// 详细清单见 web/src/components/MemoContent/SecretBlock.tsx 顶部 KeyMode 的注释。
	case secretKDFPBKDF2SHA256:
		if envelope.KdfIterations < secretMinKDFIterations || envelope.KdfIterations > secretMaxKDFIterations {
			return status.Errorf(codes.InvalidArgument, "kdf iterations out of range: %d", envelope.KdfIterations)
		}
	case secretKDFMasterV1:
		if envelope.KdfIterations != 0 {
			return status.Errorf(codes.InvalidArgument, "master envelope must not carry kdf iterations: %d", envelope.KdfIterations)
		}
	default:
		return status.Errorf(codes.InvalidArgument, "unsupported kdf: %s", envelope.Kdf)
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

// validateSecretKeySetting applies the same rules to the wrapped master key as to
// any other envelope. It lives here rather than in user_service.go so the vault's
// two write paths cannot drift: the master key is the single record every secret
// block depends on, so accepting a weakened wrapper would silently weaken all of
// them at once.
//
// An entirely empty setting is allowed through as the "not configured yet" state.
func validateSecretKeySetting(setting *v1pb.UserSetting_SecretKeySetting) error {
	// unlock_verifier is a base64 HMAC-SHA256, not part of the envelope itself
	// (it isn't a KDF/cipher parameter, and it's the one field the server actually
	// reads back later), so it's checked on its own rather than folded into
	// validateSecretEnvelope.
	if len(setting.UnlockVerifier) > secretMaxSaltLength {
		return status.Errorf(codes.InvalidArgument, "unlock_verifier is too long")
	}
	if setting.WrappedKey == "" && setting.Salt == "" && setting.Nonce == "" && setting.Verifier == "" {
		return nil
	}
	return validateSecretEnvelope(&v1pb.SecretEnvelope{
		Kdf:           setting.Kdf,
		KdfIterations: setting.KdfIterations,
		Cipher:        setting.Cipher,
		Salt:          setting.Salt,
		Nonce:         setting.Nonce,
		Verifier:      setting.Verifier,
		Ciphertext:    setting.WrappedKey,
	})
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
