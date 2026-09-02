package v1

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strings"

	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"
	colorpb "google.golang.org/genproto/googleapis/type/color"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/storage/attachmentpath"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/backup"
	"github.com/usememos/memos/server/notification"
	"github.com/usememos/memos/store"
)

const (
	maxTranscriptionConfigModelLength    = 256
	maxTranscriptionConfigLanguageLength = 32
	maxTranscriptionConfigPromptLength   = 4096
	maxBatchGetInstanceSettings          = 100
)

type instanceSettingCaller struct {
	user   *store.User
	loaded bool
}

func (c *instanceSettingCaller) currentUser(ctx context.Context, service *APIV1Service) (*store.User, error) {
	if c.loaded {
		return c.user, nil
	}
	user, err := service.fetchCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	c.user = user
	c.loaded = true
	return c.user, nil
}

// GetInstanceProfile returns the instance profile.
func (s *APIV1Service) GetInstanceProfile(ctx context.Context, _ *v1pb.GetInstanceProfileRequest) (*v1pb.InstanceProfile, error) {
	admin, err := s.GetInstanceAdmin(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance admin: %v", err)
	}

	// needs_setup reflects whether the instance has any users at all, which is
	// the real signal for first-run setup. It is deliberately independent of the
	// admin lookup: an instance that has lost its admins still has users and must
	// not be treated as a fresh install.
	limitOne := 1
	users, err := s.Store.ListUsers(ctx, &store.FindUser{Limit: &limitOne})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list users: %v", err)
	}

	instanceProfile := &v1pb.InstanceProfile{
		Version:     s.Profile.Version,
		Demo:        s.Profile.Demo,
		InstanceUrl: s.Profile.InstanceURL,
		Admin:       admin, // for display only; may be nil even on a populated instance
		Commit:      s.Profile.Commit,
		NeedsSetup:  len(users) == 0,
	}
	return instanceProfile, nil
}

func (s *APIV1Service) GetInstanceSetting(ctx context.Context, request *v1pb.GetInstanceSettingRequest) (*v1pb.InstanceSetting, error) {
	return s.getInstanceSettingByName(ctx, request.Name, &instanceSettingCaller{})
}

// BatchGetInstanceSettings returns multiple instance settings in request order.
func (s *APIV1Service) BatchGetInstanceSettings(ctx context.Context, request *v1pb.BatchGetInstanceSettingsRequest) (*v1pb.BatchGetInstanceSettingsResponse, error) {
	if len(request.Names) > maxBatchGetInstanceSettings {
		return nil, status.Errorf(codes.InvalidArgument, "too many instance setting names (max %d)", maxBatchGetInstanceSettings)
	}

	caller := &instanceSettingCaller{}
	settings := make([]*v1pb.InstanceSetting, 0, len(request.Names))
	for _, name := range request.Names {
		setting, err := s.getInstanceSettingByName(ctx, name, caller)
		if err != nil {
			return nil, err
		}
		settings = append(settings, setting)
	}

	return &v1pb.BatchGetInstanceSettingsResponse{Settings: settings}, nil
}

func (s *APIV1Service) getInstanceSettingByName(ctx context.Context, name string, caller *instanceSettingCaller) (*v1pb.InstanceSetting, error) {
	instanceSettingKeyString, err := ExtractInstanceSettingKeyFromName(name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid instance setting name: %v", err)
	}

	instanceSettingKey := storepb.InstanceSettingKey(storepb.InstanceSettingKey_value[instanceSettingKeyString])
	// Get instance setting from store with default value.
	switch instanceSettingKey {
	case storepb.InstanceSettingKey_BASIC:
		_, err = s.Store.GetInstanceBasicSetting(ctx)
	case storepb.InstanceSettingKey_GENERAL:
		_, err = s.Store.GetInstanceGeneralSetting(ctx)
	case storepb.InstanceSettingKey_MEMO_RELATED:
		_, err = s.Store.GetInstanceMemoRelatedSetting(ctx)
	case storepb.InstanceSettingKey_STORAGE:
		_, err = s.Store.GetInstanceStorageSetting(ctx)
	case storepb.InstanceSettingKey_TAGS:
		_, err = s.Store.GetInstanceTagsSetting(ctx)
	case storepb.InstanceSettingKey_NOTIFICATION:
		_, err = s.Store.GetInstanceNotificationSetting(ctx)
	case storepb.InstanceSettingKey_AI:
		_, err = s.Store.GetInstanceAISetting(ctx)
	case storepb.InstanceSettingKey_BACKUP:
		_, err = s.Store.GetInstanceBackupSetting(ctx)
	default:
		return nil, status.Errorf(codes.InvalidArgument, "unsupported instance setting key: %v", instanceSettingKey)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}

	instanceSetting, err := s.Store.GetInstanceSetting(ctx, &store.FindInstanceSetting{
		Name: instanceSettingKey.String(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}
	// BACKUP has no seeding migration (unlike e.g. STORAGE): it's only written once a backup has
	// actually run, so "not configured yet" is the common case rather than an error.
	if instanceSetting == nil && instanceSettingKey == storepb.InstanceSettingKey_BACKUP {
		instanceSetting = &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_BACKUP,
			Value: &storepb.InstanceSetting_BackupSetting{
				BackupSetting: &storepb.InstanceBackupSetting{PathTemplate: store.DefaultInstanceBackupPathTemplate},
			},
		}
	}
	if instanceSetting == nil {
		return nil, status.Errorf(codes.NotFound, "instance setting not found")
	}

	// Storage and notification settings contain credentials; restrict to admins only.
	if instanceSetting.Key == storepb.InstanceSettingKey_STORAGE ||
		instanceSetting.Key == storepb.InstanceSettingKey_NOTIFICATION ||
		instanceSetting.Key == storepb.InstanceSettingKey_BACKUP {
		user, err := caller.currentUser(ctx, s)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
		}
		if user == nil {
			return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
		}
		if user.Role != store.RoleAdmin {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	}
	isAdminCaller := false
	if instanceSetting.Key == storepb.InstanceSettingKey_AI {
		user, err := caller.currentUser(ctx, s)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
		}
		if user == nil {
			return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
		}
		isAdminCaller = user.Role == store.RoleAdmin
	}

	result := convertInstanceSettingFromStore(instanceSetting)
	if instanceSetting.Key == storepb.InstanceSettingKey_AI && !isAdminCaller {
		// Non-admin callers only need transcription.provider_id to gate the
		// editor's Transcribe button. Model / language / prompt are
		// admin-entered defaults that may contain proprietary glossary terms,
		// so they are redacted from non-admin responses.
		if ai := result.GetAiSetting(); ai != nil && ai.Transcription != nil {
			ai.Transcription.Model = ""
			ai.Transcription.Language = ""
			ai.Transcription.Prompt = ""
		}
	}
	return result, nil
}

func (s *APIV1Service) UpdateInstanceSetting(ctx context.Context, request *v1pb.UpdateInstanceSettingRequest) (*v1pb.InstanceSetting, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	// TODO: Apply update_mask if specified
	_ = request.UpdateMask

	if err := validateInstanceSetting(request.Setting); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid instance setting: %v", err)
	}

	updateSetting := convertInstanceSettingToStore(request.Setting)

	// embeddingModelChanged tracks whether an AI-setting update alters the embedding
	// provider/model, which invalidates all stored vectors and requires a full re-index.
	embeddingModelChanged := false

	// Preserve write-only credential fields when the caller sends an empty value.
	// An empty string means "no change", not "clear the credential".
	switch updateSetting.Key {
	case storepb.InstanceSettingKey_NOTIFICATION:
		if notif := updateSetting.GetNotificationSetting(); notif != nil && notif.Email != nil && notif.Email.SmtpPassword == "" {
			existing, err := s.Store.GetInstanceNotificationSetting(ctx)
			if err == nil && existing != nil && existing.Email != nil {
				if existing.Email.SmtpPassword != "" && !sameSMTPConnectionIdentity(notif.Email, existing.Email) {
					return nil, status.Errorf(codes.InvalidArgument, "smtp password is required when changing SMTP host, port, username, or encryption settings")
				}
				notif.Email.SmtpPassword = existing.Email.SmtpPassword
			}
		}
	case storepb.InstanceSettingKey_STORAGE:
		if storage := updateSetting.GetStorageSetting(); storage != nil {
			if err := s.checkAttachmentStorageSwitch(ctx, storage.StorageType); err != nil {
				return nil, err
			}
			s.logAttachmentStorageLocationMove(ctx, storage)
		}
		if storage := updateSetting.GetStorageSetting(); storage != nil && storage.S3Config != nil {
			s3Config := storage.S3Config
			// Trim accidental leading/trailing whitespace (commonly picked up when copy-pasting
			// credentials from a cloud console), since it would otherwise be signed as part of the
			// request and produce SignatureDoesNotMatch against the provider.
			s3Config.AccessKeyId = strings.TrimSpace(s3Config.AccessKeyId)
			s3Config.AccessKeySecret = strings.TrimSpace(s3Config.AccessKeySecret)
			s3Config.Endpoint = strings.TrimSpace(s3Config.Endpoint)
			s3Config.Region = strings.TrimSpace(s3Config.Region)
			s3Config.Bucket = strings.TrimSpace(s3Config.Bucket)

			if s3Config.AccessKeySecret == "" {
				existing, err := s.Store.GetInstanceStorageSetting(ctx)
				if err == nil && existing != nil && existing.S3Config != nil {
					s3Config.AccessKeySecret = existing.S3Config.AccessKeySecret
				}
			}
		}
	case storepb.InstanceSettingKey_AI:
		if err := s.prepareInstanceAISettingForUpdate(ctx, updateSetting.GetAiSetting()); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid AI setting: %v", err)
		}
		if prevAI, err := s.Store.GetInstanceAISetting(ctx); err == nil {
			prev, next := prevAI.GetEmbedding(), updateSetting.GetAiSetting().GetEmbedding()
			// Re-enabling embedding must backfill: memos created or edited while it was
			// off have no vector. Memos untouched during that window keep theirs (the
			// indexer carries them through a rebuild), so the backfill mostly re-uses
			// what's already stored. Disabling needs no rebuild at all.
			embeddingReenabled := prev.GetDisabled() && !next.GetDisabled()
			embeddingModelChanged = embeddingSignature(prev) != embeddingSignature(next) || embeddingReenabled
		}
	case storepb.InstanceSettingKey_BACKUP:
		// Only path_template is client-editable; last_backup_* is written exclusively by the
		// backup runner/RPC, so always carry the existing status forward regardless of what the
		// client sent (it has no way to know these values, and zero values must not wipe them).
		if backupSetting := updateSetting.GetBackupSetting(); backupSetting != nil {
			existing, err := s.Store.GetInstanceBackupSetting(ctx)
			if err == nil && existing != nil {
				backupSetting.LastBackupTime = existing.LastBackupTime
				backupSetting.LastBackupSuccess = existing.LastBackupSuccess
				backupSetting.LastBackupError = existing.LastBackupError
			}
			if strings.TrimSpace(backupSetting.PathTemplate) == "" {
				return nil, status.Errorf(codes.InvalidArgument, "backup path template is required")
			}
		}
	default:
		// No credential preservation needed for other setting types.
	}

	instanceSetting, err := s.Store.UpsertInstanceSetting(ctx, updateSetting)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert instance setting: %v", err)
	}

	// A changed embedding provider/model invalidates every stored vector. Enqueue a
	// full background rebuild so new vectors are generated with the new model.
	if embeddingModelChanged {
		if _, err := s.enqueueRebuild(ctx, store.IndexJobReasonModelChanged, nil); err != nil {
			slog.Error("failed to enqueue index rebuild after embedding model change", slog.Any("error", err))
		}
	}

	return convertInstanceSettingFromStore(instanceSetting), nil
}

// embeddingSignature returns a stable identity for an embedding config so a change
// in provider or model can be detected. Empty config yields an empty signature.
func embeddingSignature(cfg *storepb.EmbeddingConfig) string {
	if cfg == nil {
		return ""
	}
	return cfg.GetProviderId() + "\x00" + cfg.GetModel()
}

// BackupNow triggers an immediate SQLite database backup to the configured S3 storage.
// attachmentStorageTypeFor maps an instance storage backend to the AttachmentStorageType its
// attachments carry. Blobs kept in the database row have no storage type at all (the column is
// empty), which decodes to UNSPECIFIED.
func attachmentStorageTypeFor(storageType storepb.InstanceStorageSetting_StorageType) storepb.AttachmentStorageType {
	switch storageType {
	case storepb.InstanceStorageSetting_LOCAL:
		return storepb.AttachmentStorageType_LOCAL
	case storepb.InstanceStorageSetting_S3:
		return storepb.AttachmentStorageType_S3
	default:
		return storepb.AttachmentStorageType_ATTACHMENT_STORAGE_TYPE_UNSPECIFIED
	}
}

func instanceStorageTypeLabel(storageType storepb.InstanceStorageSetting_StorageType) string {
	switch storageType {
	case storepb.InstanceStorageSetting_LOCAL:
		return "local storage"
	case storepb.InstanceStorageSetting_S3:
		return "S3 storage"
	default:
		return "database storage"
	}
}

// checkAttachmentStorageSwitch refuses to flip the active attachment backend while attachments
// still live in the current one. An instance is meant to be entirely local or entirely S3: a
// mixed instance forces every later question (backup, migration, capacity) to be answered twice,
// and nothing needs that flexibility. Switching is allowed only after the existing attachments
// have been migrated over (see docs/dev/requirements/storage/20260826-attachment-object-migration.md).
//
// EXTERNAL attachments are exempt: their bytes were never held by this instance.
func (s *APIV1Service) checkAttachmentStorageSwitch(ctx context.Context, target storepb.InstanceStorageSetting_StorageType) error {
	if target == storepb.InstanceStorageSetting_STORAGE_TYPE_UNSPECIFIED {
		return nil
	}
	existing, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get instance storage setting: %v", err)
	}
	if existing == nil || existing.StorageType == target {
		return nil
	}

	counts, err := s.Store.CountAttachmentsByStorageType(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to count attachments by storage type: %v", err)
	}
	targetAttachmentType := attachmentStorageTypeFor(target)
	for attachmentType, count := range counts {
		if count == 0 || attachmentType == targetAttachmentType || attachmentType == storepb.AttachmentStorageType_EXTERNAL {
			continue
		}
		return status.Errorf(
			codes.FailedPrecondition,
			"cannot switch attachment storage to %s: %d attachment(s) still stored in %s. Migrate them first",
			instanceStorageTypeLabel(target),
			count,
			attachmentStorageTypeLabel(attachmentType),
		)
	}
	return nil
}

// logAttachmentStorageLocationMove records that the instance was pointed at a different place
// than the one its objects are in.
//
// The read path resolves keys against the instance's current S3 config, so this takes effect
// immediately while the objects stay where they were: every existing attachment stops resolving
// until `migrate-attachments` has copied them across. That is the intended first step of a
// migration, not an error, which is why this only records it -- but it is also a site-wide
// outage if it was done unaware, and an operator reading the log afterwards deserves to find
// the reason rather than infer it.
func (s *APIV1Service) logAttachmentStorageLocationMove(ctx context.Context, next *storepb.InstanceStorageSetting) {
	existing, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil || existing.GetS3Config() == nil {
		return
	}
	current := existing.GetS3Config()
	target := next.GetS3Config()
	if target == nil {
		return
	}
	movedDir := attachmentpath.Dir(existing.FilepathTemplate) != attachmentpath.Dir(next.FilepathTemplate)
	if current.Endpoint == target.Endpoint && current.Bucket == target.Bucket && !movedDir {
		return
	}

	counts, err := s.Store.CountAttachmentsByStorageType(ctx)
	if err != nil || counts[storepb.AttachmentStorageType_S3] == 0 {
		return
	}
	slog.Warn("attachment storage location changed; existing objects were not moved",
		slog.Int("attachmentsInS3", counts[storepb.AttachmentStorageType_S3]),
		slog.String("endpoint", current.Endpoint+" -> "+target.Endpoint),
		slog.String("bucket", current.Bucket+" -> "+target.Bucket),
		slog.String("directory", attachmentpath.Dir(existing.FilepathTemplate)+" -> "+attachmentpath.Dir(next.FilepathTemplate)),
		slog.String("action", "run `migrate-attachments` to copy them, or attachments will not resolve"))
}

func attachmentStorageTypeLabel(storageType storepb.AttachmentStorageType) string {
	switch storageType {
	case storepb.AttachmentStorageType_LOCAL:
		return "local storage"
	case storepb.AttachmentStorageType_S3:
		return "S3 storage"
	case storepb.AttachmentStorageType_EXTERNAL:
		return "external storage"
	default:
		return "the database"
	}
}

func (s *APIV1Service) BackupNow(ctx context.Context, _ *v1pb.BackupNowRequest) (*v1pb.BackupNowResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if err := backup.Run(ctx, s.Profile, s.Store); err != nil {
		return nil, status.Errorf(codes.Internal, "backup failed: %v", err)
	}

	backupSetting, err := s.Store.GetInstanceBackupSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get backup status: %v", err)
	}
	return &v1pb.BackupNowResponse{BackupTime: backupSetting.GetLastBackupTime()}, nil
}

// TestAIProvider verifies connectivity to an AI provider with a minimal live chat-completion call.
func (s *APIV1Service) TestAIProvider(ctx context.Context, request *v1pb.TestAIProviderRequest) (*v1pb.TestAIProviderResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	providerType := convertAIProviderTypeFromStore(storepb.AIProviderType(request.Type))
	if providerType == "" {
		return nil, status.Errorf(codes.InvalidArgument, "provider type is required")
	}

	endpoint := strings.TrimSpace(request.Endpoint)
	apiKey := request.ApiKey
	providerID := strings.TrimSpace(request.ProviderId)

	if providerID != "" {
		aiSetting, err := s.Store.GetInstanceAISetting(ctx)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
		}
		for _, provider := range aiSetting.GetProviders() {
			if provider.GetId() == providerID {
				if endpoint == "" {
					endpoint = provider.GetEndpoint()
				}
				if apiKey == "" {
					apiKey = provider.GetApiKey()
				}
				break
			}
		}
	}

	model := strings.TrimSpace(request.Model)
	if model == "" {
		return nil, status.Errorf(codes.InvalidArgument, "model is required")
	}
	if apiKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "API key is required")
	}

	provider := ai.ProviderConfig{
		Type:     providerType,
		Endpoint: endpoint,
		APIKey:   apiKey,
	}

	probe := ai.ProbeChat
	if request.Capability == v1pb.TestAIProviderRequest_EMBEDDING {
		probe = ai.ProbeEmbed
	}
	if err := probe(ctx, provider, model); err != nil {
		return &v1pb.TestAIProviderResponse{Success: false, Message: err.Error()}, nil
	}
	return &v1pb.TestAIProviderResponse{Success: true, Message: "Connection succeeded"}, nil
}

func (s *APIV1Service) TestInstanceEmailSetting(ctx context.Context, request *v1pb.TestInstanceEmailSettingRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	emailSetting, err := s.resolveTestEmailSetting(ctx, request.Email)
	if err != nil {
		return nil, err
	}

	recipientEmail := strings.TrimSpace(request.RecipientEmail)
	if recipientEmail == "" {
		recipientEmail = strings.TrimSpace(user.Email)
	}
	if recipientEmail == "" {
		return nil, status.Errorf(codes.InvalidArgument, "recipient email is required")
	}

	if err := notification.ValidateEmailSetting(emailSetting); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid notification email setting: %v", err)
	}

	if err := notification.SendTestEmail(emailSetting, recipientEmail); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to send test email: %v. Check that the SMTP port matches encryption: Gmail uses port 587 with STARTTLS on and SSL/TLS off; port 465 requires SSL/TLS on", err)
	}

	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) resolveTestEmailSetting(ctx context.Context, requestEmail *v1pb.InstanceSetting_NotificationSetting_EmailSetting) (*storepb.InstanceNotificationSetting_EmailSetting, error) {
	if requestEmail == nil {
		existing, err := s.Store.GetInstanceNotificationSetting(ctx)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get notification setting: %v", err)
		}
		return existing.GetEmail(), nil
	}

	emailSetting := convertInstanceNotificationSettingToStore(&v1pb.InstanceSetting_NotificationSetting{Email: requestEmail}).GetEmail()
	if emailSetting.SmtpPassword != "" {
		return emailSetting, nil
	}

	existing, err := s.Store.GetInstanceNotificationSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get notification setting: %v", err)
	}
	existingEmail := existing.GetEmail()
	if existingEmail == nil || existingEmail.SmtpPassword == "" {
		return emailSetting, nil
	}
	if sameSMTPConnectionIdentity(emailSetting, existingEmail) {
		emailSetting.SmtpPassword = existingEmail.SmtpPassword
		return emailSetting, nil
	}
	return nil, status.Errorf(codes.InvalidArgument, "smtp password is required when changing SMTP host, port, username, or encryption settings")
}

func sameSMTPConnectionIdentity(setting, existing *storepb.InstanceNotificationSetting_EmailSetting) bool {
	if setting == nil || existing == nil {
		return false
	}
	return strings.TrimSpace(setting.SmtpHost) == strings.TrimSpace(existing.SmtpHost) &&
		setting.SmtpPort == existing.SmtpPort &&
		strings.TrimSpace(setting.SmtpUsername) == strings.TrimSpace(existing.SmtpUsername) &&
		setting.UseTls == existing.UseTls &&
		setting.UseSsl == existing.UseSsl
}

func convertInstanceSettingFromStore(setting *storepb.InstanceSetting) *v1pb.InstanceSetting {
	instanceSetting := &v1pb.InstanceSetting{
		Name: fmt.Sprintf("instance/settings/%s", setting.Key.String()),
	}
	switch setting.Value.(type) {
	case *storepb.InstanceSetting_GeneralSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_GeneralSetting_{
			GeneralSetting: convertInstanceGeneralSettingFromStore(setting.GetGeneralSetting()),
		}
	case *storepb.InstanceSetting_StorageSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_StorageSetting_{
			StorageSetting: convertInstanceStorageSettingFromStore(setting.GetStorageSetting()),
		}
	case *storepb.InstanceSetting_MemoRelatedSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_MemoRelatedSetting_{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingFromStore(setting.GetMemoRelatedSetting()),
		}
	case *storepb.InstanceSetting_TagsSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_TagsSetting_{
			TagsSetting: convertInstanceTagsSettingFromStore(setting.GetTagsSetting()),
		}
	case *storepb.InstanceSetting_NotificationSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_NotificationSetting_{
			NotificationSetting: convertInstanceNotificationSettingFromStore(setting.GetNotificationSetting()),
		}
	case *storepb.InstanceSetting_AiSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_AiSetting{
			AiSetting: convertInstanceAISettingFromStore(setting.GetAiSetting()),
		}
	case *storepb.InstanceSetting_BackupSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_BackupSetting_{
			BackupSetting: convertInstanceBackupSettingFromStore(setting.GetBackupSetting()),
		}
	default:
		// Leave Value unset for unsupported setting variants.
	}
	return instanceSetting
}

func convertInstanceBackupSettingFromStore(setting *storepb.InstanceBackupSetting) *v1pb.InstanceSetting_BackupSetting {
	if setting == nil {
		return nil
	}
	backupSetting := &v1pb.InstanceSetting_BackupSetting{
		PathTemplate:      setting.PathTemplate,
		LastBackupSuccess: setting.LastBackupSuccess,
		LastBackupError:   setting.LastBackupError,
	}
	if setting.LastBackupTime != nil {
		backupSetting.LastBackupTime = setting.LastBackupTime
	}
	return backupSetting
}

func convertInstanceBackupSettingToStore(setting *v1pb.InstanceSetting_BackupSetting) *storepb.InstanceBackupSetting {
	if setting == nil {
		return nil
	}
	backupSetting := &storepb.InstanceBackupSetting{
		PathTemplate:      setting.PathTemplate,
		LastBackupSuccess: setting.LastBackupSuccess,
		LastBackupError:   setting.LastBackupError,
	}
	if setting.LastBackupTime != nil {
		backupSetting.LastBackupTime = setting.LastBackupTime
	}
	return backupSetting
}

func convertInstanceSettingToStore(setting *v1pb.InstanceSetting) *storepb.InstanceSetting {
	settingKeyString, _ := ExtractInstanceSettingKeyFromName(setting.Name)
	instanceSetting := &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey(storepb.InstanceSettingKey_value[settingKeyString]),
		Value: &storepb.InstanceSetting_GeneralSetting{
			GeneralSetting: convertInstanceGeneralSettingToStore(setting.GetGeneralSetting()),
		},
	}
	switch instanceSetting.Key {
	case storepb.InstanceSettingKey_GENERAL:
		instanceSetting.Value = &storepb.InstanceSetting_GeneralSetting{
			GeneralSetting: convertInstanceGeneralSettingToStore(setting.GetGeneralSetting()),
		}
	case storepb.InstanceSettingKey_STORAGE:
		instanceSetting.Value = &storepb.InstanceSetting_StorageSetting{
			StorageSetting: convertInstanceStorageSettingToStore(setting.GetStorageSetting()),
		}
	case storepb.InstanceSettingKey_MEMO_RELATED:
		instanceSetting.Value = &storepb.InstanceSetting_MemoRelatedSetting{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingToStore(setting.GetMemoRelatedSetting()),
		}
	case storepb.InstanceSettingKey_TAGS:
		instanceSetting.Value = &storepb.InstanceSetting_TagsSetting{
			TagsSetting: convertInstanceTagsSettingToStore(setting.GetTagsSetting()),
		}
	case storepb.InstanceSettingKey_NOTIFICATION:
		instanceSetting.Value = &storepb.InstanceSetting_NotificationSetting{
			NotificationSetting: convertInstanceNotificationSettingToStore(setting.GetNotificationSetting()),
		}
	case storepb.InstanceSettingKey_AI:
		instanceSetting.Value = &storepb.InstanceSetting_AiSetting{
			AiSetting: convertInstanceAISettingToStore(setting.GetAiSetting()),
		}
	case storepb.InstanceSettingKey_BACKUP:
		instanceSetting.Value = &storepb.InstanceSetting_BackupSetting{
			BackupSetting: convertInstanceBackupSettingToStore(setting.GetBackupSetting()),
		}
	default:
		// Keep the default GeneralSetting value
	}
	return instanceSetting
}

func convertInstanceGeneralSettingFromStore(setting *storepb.InstanceGeneralSetting) *v1pb.InstanceSetting_GeneralSetting {
	if setting == nil {
		return nil
	}

	generalSetting := &v1pb.InstanceSetting_GeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &v1pb.InstanceSetting_GeneralSetting_CustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceGeneralSettingToStore(setting *v1pb.InstanceSetting_GeneralSetting) *storepb.InstanceGeneralSetting {
	if setting == nil {
		return nil
	}
	generalSetting := &storepb.InstanceGeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &storepb.InstanceCustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceStorageSettingFromStore(settingpb *storepb.InstanceStorageSetting) *v1pb.InstanceSetting_StorageSetting {
	if settingpb == nil {
		return nil
	}
	setting := &v1pb.InstanceSetting_StorageSetting{
		StorageType:       v1pb.InstanceSetting_StorageSetting_StorageType(settingpb.StorageType),
		FilepathTemplate:  settingpb.FilepathTemplate,
		UploadSizeLimitMb: settingpb.UploadSizeLimitMb,
	}
	if settingpb.S3Config != nil {
		setting.S3Config = &v1pb.InstanceSetting_StorageSetting_S3Config{
			AccessKeyId: settingpb.S3Config.AccessKeyId,
			// AccessKeySecret is write-only: never returned in responses.
			Endpoint:              settingpb.S3Config.Endpoint,
			Region:                settingpb.S3Config.Region,
			Bucket:                settingpb.S3Config.Bucket,
			UsePathStyle:          settingpb.S3Config.UsePathStyle,
			InsecureSkipTlsVerify: settingpb.S3Config.InsecureSkipTlsVerify,
		}
	}
	return setting
}

func convertInstanceStorageSettingToStore(setting *v1pb.InstanceSetting_StorageSetting) *storepb.InstanceStorageSetting {
	if setting == nil {
		return nil
	}
	settingpb := &storepb.InstanceStorageSetting{
		StorageType:       storepb.InstanceStorageSetting_StorageType(setting.StorageType),
		FilepathTemplate:  setting.FilepathTemplate,
		UploadSizeLimitMb: setting.UploadSizeLimitMb,
	}
	if setting.S3Config != nil {
		settingpb.S3Config = &storepb.StorageS3Config{
			AccessKeyId:           setting.S3Config.AccessKeyId,
			AccessKeySecret:       setting.S3Config.AccessKeySecret,
			Endpoint:              setting.S3Config.Endpoint,
			Region:                setting.S3Config.Region,
			Bucket:                setting.S3Config.Bucket,
			UsePathStyle:          setting.S3Config.UsePathStyle,
			InsecureSkipTlsVerify: setting.S3Config.InsecureSkipTlsVerify,
		}
	}
	return settingpb
}

func convertInstanceMemoRelatedSettingFromStore(setting *storepb.InstanceMemoRelatedSetting) *v1pb.InstanceSetting_MemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_MemoRelatedSetting{
		ContentLengthLimit:    setting.ContentLengthLimit,
		EnableDoubleClickEdit: setting.EnableDoubleClickEdit,
		Reactions:             setting.Reactions,
	}
}

func convertInstanceMemoRelatedSettingToStore(setting *v1pb.InstanceSetting_MemoRelatedSetting) *storepb.InstanceMemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &storepb.InstanceMemoRelatedSetting{
		ContentLengthLimit:    setting.ContentLengthLimit,
		EnableDoubleClickEdit: setting.EnableDoubleClickEdit,
		Reactions:             setting.Reactions,
	}
}

func convertInstanceTagsSettingFromStore(setting *storepb.InstanceTagsSetting) *v1pb.InstanceSetting_TagsSetting {
	if setting == nil {
		return nil
	}
	tags := make(map[string]*v1pb.InstanceSetting_TagMetadata, len(setting.Tags))
	for tag, metadata := range setting.Tags {
		tags[tag] = &v1pb.InstanceSetting_TagMetadata{
			BackgroundColor: metadata.GetBackgroundColor(),
			BlurContent:     metadata.GetBlurContent(),
		}
	}
	return &v1pb.InstanceSetting_TagsSetting{
		Tags: tags,
	}
}

func convertInstanceTagsSettingToStore(setting *v1pb.InstanceSetting_TagsSetting) *storepb.InstanceTagsSetting {
	if setting == nil {
		return nil
	}
	tags := make(map[string]*storepb.InstanceTagMetadata, len(setting.Tags))
	for tag, metadata := range setting.Tags {
		tags[tag] = &storepb.InstanceTagMetadata{
			BackgroundColor: metadata.GetBackgroundColor(),
			BlurContent:     metadata.GetBlurContent(),
		}
	}
	return &storepb.InstanceTagsSetting{
		Tags: tags,
	}
}

func convertInstanceNotificationSettingFromStore(setting *storepb.InstanceNotificationSetting) *v1pb.InstanceSetting_NotificationSetting {
	if setting == nil {
		return nil
	}

	notificationSetting := &v1pb.InstanceSetting_NotificationSetting{}
	if setting.Email != nil {
		notificationSetting.Email = &v1pb.InstanceSetting_NotificationSetting_EmailSetting{
			Enabled:      setting.Email.Enabled,
			SmtpHost:     setting.Email.SmtpHost,
			SmtpPort:     setting.Email.SmtpPort,
			SmtpUsername: setting.Email.SmtpUsername,
			// SmtpPassword is write-only: never returned in responses.
			FromEmail: setting.Email.FromEmail,
			FromName:  setting.Email.FromName,
			ReplyTo:   setting.Email.ReplyTo,
			UseTls:    setting.Email.UseTls,
			UseSsl:    setting.Email.UseSsl,
		}
	}
	return notificationSetting
}

func convertInstanceNotificationSettingToStore(setting *v1pb.InstanceSetting_NotificationSetting) *storepb.InstanceNotificationSetting {
	if setting == nil {
		return nil
	}

	notificationSetting := &storepb.InstanceNotificationSetting{}
	if setting.Email != nil {
		notificationSetting.Email = &storepb.InstanceNotificationSetting_EmailSetting{
			Enabled:      setting.Email.Enabled,
			SmtpHost:     setting.Email.SmtpHost,
			SmtpPort:     setting.Email.SmtpPort,
			SmtpUsername: setting.Email.SmtpUsername,
			SmtpPassword: setting.Email.SmtpPassword,
			FromEmail:    setting.Email.FromEmail,
			FromName:     setting.Email.FromName,
			ReplyTo:      setting.Email.ReplyTo,
			UseTls:       setting.Email.UseTls,
			UseSsl:       setting.Email.UseSsl,
		}
	}
	return notificationSetting
}

func convertInstanceAISettingFromStore(setting *storepb.InstanceAISetting) *v1pb.InstanceSetting_AISetting {
	if setting == nil {
		return nil
	}

	aiSetting := &v1pb.InstanceSetting_AISetting{
		Providers:         make([]*v1pb.InstanceSetting_AIProviderConfig, 0, len(setting.Providers)),
		Transcription:     convertTranscriptionConfigFromStore(setting.GetTranscription()),
		DefaultProviderId: setting.GetDefaultProviderId(),
		FormatPdfText:     setting.GetFormatPdfText(),
		Embedding:         convertEmbeddingConfigFromStore(setting.GetEmbedding()),
	}
	for _, provider := range setting.Providers {
		if provider == nil {
			continue
		}
		apiKey := provider.GetApiKey()
		models := make([]*v1pb.InstanceSetting_AIModelConfig, 0, len(provider.GetModels()))
		for _, model := range provider.GetModels() {
			if model == nil {
				continue
			}
			models = append(models, &v1pb.InstanceSetting_AIModelConfig{
				Id:   model.GetId(),
				Name: model.GetName(),
			})
		}
		aiSetting.Providers = append(aiSetting.Providers, &v1pb.InstanceSetting_AIProviderConfig{
			Id:         provider.GetId(),
			Title:      provider.GetTitle(),
			Type:       v1pb.InstanceSetting_AIProviderType(provider.GetType()),
			Endpoint:   provider.GetEndpoint(),
			ApiKeySet:  apiKey != "",
			ApiKeyHint: maskAPIKey(apiKey),
			Models:     models,
		})
	}
	return aiSetting
}

func convertInstanceAISettingToStore(setting *v1pb.InstanceSetting_AISetting) *storepb.InstanceAISetting {
	if setting == nil {
		return nil
	}

	aiSetting := &storepb.InstanceAISetting{
		Providers:         make([]*storepb.AIProviderConfig, 0, len(setting.Providers)),
		Transcription:     convertTranscriptionConfigToStore(setting.GetTranscription()),
		DefaultProviderId: setting.GetDefaultProviderId(),
		FormatPdfText:     setting.GetFormatPdfText(),
		Embedding:         convertEmbeddingConfigToStore(setting.GetEmbedding()),
	}
	for _, provider := range setting.Providers {
		if provider == nil {
			continue
		}
		models := make([]*storepb.AIModelConfig, 0, len(provider.GetModels()))
		for _, model := range provider.GetModels() {
			if model == nil {
				continue
			}
			models = append(models, &storepb.AIModelConfig{
				Id:   model.GetId(),
				Name: model.GetName(),
			})
		}
		aiSetting.Providers = append(aiSetting.Providers, &storepb.AIProviderConfig{
			Id:       provider.GetId(),
			Title:    provider.GetTitle(),
			Type:     storepb.AIProviderType(provider.GetType()),
			Endpoint: provider.GetEndpoint(),
			ApiKey:   provider.GetApiKey(),
			Models:   models,
		})
	}
	return aiSetting
}

func convertTranscriptionConfigFromStore(setting *storepb.TranscriptionConfig) *v1pb.InstanceSetting_TranscriptionConfig {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_TranscriptionConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Language:   setting.GetLanguage(),
		Prompt:     setting.GetPrompt(),
	}
}

func convertTranscriptionConfigToStore(setting *v1pb.InstanceSetting_TranscriptionConfig) *storepb.TranscriptionConfig {
	if setting == nil {
		return nil
	}
	return &storepb.TranscriptionConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Language:   setting.GetLanguage(),
		Prompt:     setting.GetPrompt(),
	}
}

func convertEmbeddingConfigFromStore(setting *storepb.EmbeddingConfig) *v1pb.InstanceSetting_EmbeddingConfig {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_EmbeddingConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Disabled:   setting.GetDisabled(),
	}
}

func convertEmbeddingConfigToStore(setting *v1pb.InstanceSetting_EmbeddingConfig) *storepb.EmbeddingConfig {
	if setting == nil {
		return nil
	}
	return &storepb.EmbeddingConfig{
		ProviderId: setting.GetProviderId(),
		Model:      setting.GetModel(),
		Disabled:   setting.GetDisabled(),
	}
}

func validateInstanceSetting(setting *v1pb.InstanceSetting) error {
	key, err := ExtractInstanceSettingKeyFromName(setting.Name)
	if err != nil {
		return err
	}
	if key != storepb.InstanceSettingKey_TAGS.String() {
		return nil
	}
	return validateInstanceTagsSetting(setting.GetTagsSetting())
}

func (s *APIV1Service) prepareInstanceAISettingForUpdate(ctx context.Context, setting *storepb.InstanceAISetting) error {
	if setting == nil {
		return errors.New("AI setting is required")
	}

	existing, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get existing AI setting")
	}
	existingProviders := map[string]*storepb.AIProviderConfig{}
	if existing != nil {
		for _, provider := range existing.Providers {
			if provider != nil && provider.Id != "" {
				existingProviders[provider.Id] = provider
			}
		}
	}

	seenIDs := map[string]bool{}
	for _, provider := range setting.Providers {
		if provider == nil {
			return errors.New("provider cannot be nil")
		}

		provider.Id = strings.TrimSpace(provider.Id)
		if provider.Id == "" {
			provider.Id = shortuuid.New()
		}
		if seenIDs[provider.Id] {
			return errors.Errorf("duplicate provider ID %q", provider.Id)
		}
		seenIDs[provider.Id] = true

		provider.Title = strings.TrimSpace(provider.Title)
		if provider.Title == "" {
			return errors.New("provider title is required")
		}
		if provider.Type != storepb.AIProviderType_OPENAI && provider.Type != storepb.AIProviderType_GEMINI {
			return errors.Errorf("provider %q has unsupported type", provider.Id)
		}

		provider.Endpoint = strings.TrimSpace(provider.Endpoint)
		if provider.Type == storepb.AIProviderType_OPENAI && provider.Endpoint == "" {
			provider.Endpoint = "https://api.openai.com/v1"
		}
		if provider.Type == storepb.AIProviderType_GEMINI && provider.Endpoint == "" {
			provider.Endpoint = "https://generativelanguage.googleapis.com/v1beta"
		}

		if provider.ApiKey == "" {
			if existingProvider, ok := existingProviders[provider.Id]; ok {
				provider.ApiKey = existingProvider.ApiKey
			}
		}
		if provider.ApiKey == "" {
			return errors.Errorf("provider %q API key is required", provider.Id)
		}

		models := make([]*storepb.AIModelConfig, 0, len(provider.Models))
		seenModelIDs := map[string]bool{}
		for _, model := range provider.Models {
			if model == nil {
				continue
			}
			model.Id = strings.TrimSpace(model.Id)
			if model.Id == "" {
				continue
			}
			if seenModelIDs[model.Id] {
				continue
			}
			seenModelIDs[model.Id] = true
			model.Name = strings.TrimSpace(model.Name)
			models = append(models, model)
		}
		provider.Models = models
	}

	setting.DefaultProviderId = strings.TrimSpace(setting.DefaultProviderId)
	if setting.DefaultProviderId != "" && !seenIDs[setting.DefaultProviderId] {
		return errors.Errorf("default_provider_id %q does not reference any configured provider", setting.DefaultProviderId)
	}

	if err := preparePersistedTranscriptionConfig(setting, existing); err != nil {
		return err
	}
	return nil
}

func preparePersistedTranscriptionConfig(setting *storepb.InstanceAISetting, existing *storepb.InstanceAISetting) error {
	// Preserve the previously stored transcription config when the request omits it,
	// matching the same "absence == keep" semantics used for API keys. The preserved
	// config still falls through to validation below, so a stale provider_id is
	// rejected if the same update removed or renamed its referenced provider.
	if setting.Transcription == nil && existing != nil {
		setting.Transcription = existing.GetTranscription()
	}
	if setting.Transcription == nil {
		return nil
	}

	cfg := setting.Transcription
	cfg.ProviderId = strings.TrimSpace(cfg.ProviderId)
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.Language = strings.TrimSpace(cfg.Language)
	cfg.Prompt = strings.TrimSpace(cfg.Prompt)

	if cfg.ProviderId != "" {
		referenced := false
		for _, provider := range setting.Providers {
			if provider != nil && provider.Id == cfg.ProviderId {
				referenced = true
				break
			}
		}
		if !referenced {
			return errors.Errorf("transcription provider_id %q does not reference any configured provider", cfg.ProviderId)
		}
	}

	if len(cfg.Model) > maxTranscriptionConfigModelLength {
		return errors.Errorf("transcription model is too long; maximum length is %d characters", maxTranscriptionConfigModelLength)
	}
	if len(cfg.Language) > maxTranscriptionConfigLanguageLength {
		return errors.Errorf("transcription language is too long; maximum length is %d characters", maxTranscriptionConfigLanguageLength)
	}
	if len(cfg.Prompt) > maxTranscriptionConfigPromptLength {
		return errors.Errorf("transcription prompt is too long; maximum length is %d characters", maxTranscriptionConfigPromptLength)
	}
	return nil
}

func maskAPIKey(apiKey string) string {
	if apiKey == "" {
		return ""
	}
	if len(apiKey) <= 8 {
		return "..."
	}
	prefixLength := min(4, len(apiKey))
	return apiKey[:prefixLength] + "..." + apiKey[len(apiKey)-4:]
}

func validateInstanceTagsSetting(setting *v1pb.InstanceSetting_TagsSetting) error {
	if setting == nil {
		return errors.New("tags setting is required")
	}
	for tag, metadata := range setting.Tags {
		if strings.TrimSpace(tag) == "" {
			return errors.New("tag key cannot be empty")
		}
		if _, err := regexp.Compile(tag); err != nil {
			return errors.Errorf("tag key %q is not a valid regex pattern: %v", tag, err)
		}
		if metadata == nil {
			return errors.Errorf("tag metadata is required for %q", tag)
		}
		if metadata.GetBackgroundColor() != nil {
			if err := validateInstanceColor(metadata.GetBackgroundColor()); err != nil {
				return errors.Wrapf(err, "background_color for %q", tag)
			}
		}
	}
	return nil
}

func validateInstanceColor(color *colorpb.Color) error {
	if err := validateInstanceColorComponent("red", color.GetRed()); err != nil {
		return err
	}
	if err := validateInstanceColorComponent("green", color.GetGreen()); err != nil {
		return err
	}
	if err := validateInstanceColorComponent("blue", color.GetBlue()); err != nil {
		return err
	}
	if alpha := color.GetAlpha(); alpha != nil {
		if err := validateInstanceColorComponent("alpha", alpha.GetValue()); err != nil {
			return err
		}
	}
	return nil
}

func validateInstanceColorComponent(name string, value float32) error {
	if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
		return errors.Errorf("%s must be a finite number", name)
	}
	if value < 0 || value > 1 {
		return errors.Errorf("%s must be between 0 and 1", name)
	}
	return nil
}

func (s *APIV1Service) GetInstanceAdmin(ctx context.Context) (*v1pb.User, error) {
	adminUserType := store.RoleAdmin
	user, err := s.Store.GetUser(ctx, &store.FindUser{
		Role: &adminUserType,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to find admin")
	}
	if user == nil {
		return nil, nil
	}

	currentUser, _ := s.fetchCurrentUser(ctx)
	return convertUserFromStore(user, currentUser), nil
}
