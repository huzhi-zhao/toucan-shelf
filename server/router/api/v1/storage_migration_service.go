package v1

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"path"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/storage/s3"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/storagemigration"
	"github.com/usememos/memos/store"
)

// Attachment storage migration, phase 1: drafting a target location and proving it actually works.
// Nothing is frozen and no object is copied here. See
// docs/dev/design/20260902-attachment-storage-migration.md.

// probeContent is written and read back verbatim by the precheck. Reading back the exact bytes is
// the point: an endpoint that answers 200 to a PUT and hands back something else on the GET (a
// proxy that rewrites bodies, a bucket that silently transforms objects) is a broken target, and
// only a byte comparison catches it.
var probeContent = []byte("toucanshelf attachment storage migration probe\n")

// PrecheckStorageMigration writes, reads back and deletes a probe object at the drafted target,
// and records the outcome on the migration setting.
//
// Testing the connection is not enough. A bucket can exist, credentials can authenticate, and the
// migration can still fail on the first object: no s3:PutObject on this prefix, a bucket policy
// that only allows certain key shapes, or a CDN in front of the endpoint that rewrites headers the
// SDK signed (the Accept-Encoding problem in internal/storage/s3/s3.go). All of those only surface
// on a real round trip, which is why this writes a real object.
func (s *APIV1Service) PrecheckStorageMigration(ctx context.Context, _ *v1pb.PrecheckStorageMigrationRequest) (*v1pb.InstanceSetting, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Error(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Error(codes.PermissionDenied, "permission denied")
	}

	migration, err := s.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get storage migration setting: %v", err)
	}
	target := migration.GetTargetS3Config()
	if target == nil {
		return nil, status.Error(codes.FailedPrecondition, "no migration target is drafted")
	}
	switch migration.State {
	case storepb.InstanceStorageMigrationSetting_DRAFT, storepb.InstanceStorageMigrationSetting_PRECHECKED:
	default:
		return nil, status.Errorf(codes.FailedPrecondition,
			"the migration is past the precheck stage (state %s); prechecking now would say nothing about what has already been copied", migration.State)
	}

	storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get storage setting: %v", err)
	}

	result := runStorageMigrationProbe(ctx, target)
	result.ServerSideCopy = storagemigration.CanServerSideCopy(storageSetting.GetS3Config(), target)

	migration.Precheck = result
	if result.Passed {
		migration.State = storepb.InstanceStorageMigrationSetting_PRECHECKED
	} else {
		// A failed precheck is not a dead end, it is a reason to go fix the target, so drop back
		// to DRAFT rather than leaving a stale PRECHECKED behind.
		migration.State = storepb.InstanceStorageMigrationSetting_DRAFT
	}
	migration.UpdateTime = timestamppb.Now()

	saved, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: migration},
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save precheck result: %v", err)
	}
	return convertInstanceSettingFromStore(saved), nil
}

// runStorageMigrationProbe performs the write-read-delete round trip. It never returns an error:
// a failed probe is a recorded result the admin has to act on, not a broken API call.
func runStorageMigrationProbe(ctx context.Context, target *storepb.StorageS3Config) *storepb.InstanceStorageMigrationSetting_PrecheckResult {
	result := &storepb.InstanceStorageMigrationSetting_PrecheckResult{
		CheckTime: timestamppb.Now(),
		ProbeKey:  buildProbeKey(target.GetRootPrefix()),
	}
	fail := func(reason string, err error) *storepb.InstanceStorageMigrationSetting_PrecheckResult {
		result.Passed = false
		result.Error = reason
		if err != nil {
			result.Error = reason + ": " + err.Error()
		}
		return result
	}

	client, err := s3.NewClient(ctx, target)
	if err != nil {
		return fail("failed to create an S3 client for the target", err)
	}
	if _, err := client.UploadObject(ctx, result.ProbeKey, "application/octet-stream", bytes.NewReader(probeContent)); err != nil {
		return fail("cannot write to the target location", err)
	}
	// From here on the probe object exists, so every exit path has to try to remove it.
	defer func() {
		if err := client.DeleteObject(ctx, result.ProbeKey); err != nil {
			// Deleting is not a capability the migration itself needs (it never deletes a real
			// object), so a failure here does not fail the precheck. The key is recorded on the
			// result so the leftover can be removed by hand.
			slog.Warn("failed to delete storage migration probe object",
				slog.String("key", result.ProbeKey), slog.String("error", err.Error()))
		}
	}()

	stat, err := client.StatObject(ctx, result.ProbeKey)
	if err != nil {
		return fail("cannot stat the object just written to the target", err)
	}
	if !stat.Exists {
		return fail("the object written to the target is not there when read back; check bucket policies and any proxy in front of the endpoint", nil)
	}
	readBack, err := client.GetObject(ctx, result.ProbeKey)
	if err != nil {
		return fail("cannot read back from the target location", err)
	}
	if !bytes.Equal(readBack, probeContent) {
		return fail("the target returned different bytes than were written; something between Toucan and the bucket is rewriting objects", nil)
	}

	result.Passed = true
	result.Error = ""
	return result
}

// buildProbeKey puts the probe under the same root prefix the attachments will use, so a bucket
// policy scoped to that prefix is actually exercised. The name is random to keep two concurrent
// prechecks (or a leftover from a crashed one) from colliding.
func buildProbeKey(rootPrefix string) string {
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		// A predictable name is fine; uniqueness is a convenience here, not a guarantee.
		return path.Join(strings.Trim(rootPrefix, "/"), ".toucan-migration-probe")
	}
	return path.Join(strings.Trim(rootPrefix, "/"), ".toucan-migration-probe-"+hex.EncodeToString(suffix))
}

func convertStorageMigrationSettingFromStore(setting *storepb.InstanceStorageMigrationSetting) *v1pb.InstanceSetting_StorageMigrationSetting {
	if setting == nil {
		return nil
	}
	result := &v1pb.InstanceSetting_StorageMigrationSetting{
		State:          v1pb.InstanceSetting_StorageMigrationSetting_State(setting.State),
		TargetS3Config: convertS3ConfigFromStore(setting.TargetS3Config),
		CreateTime:     setting.CreateTime,
		UpdateTime:     setting.UpdateTime,
		LastError:      setting.LastError,
	}
	if setting.Precheck != nil {
		result.Precheck = &v1pb.InstanceSetting_StorageMigrationSetting_PrecheckResult{
			Passed:         setting.Precheck.Passed,
			Error:          setting.Precheck.Error,
			CheckTime:      setting.Precheck.CheckTime,
			ProbeKey:       setting.Precheck.ProbeKey,
			ServerSideCopy: setting.Precheck.ServerSideCopy,
		}
	}
	if setting.Progress != nil {
		result.Progress = &v1pb.InstanceSetting_StorageMigrationSetting_Progress{
			Total:   setting.Progress.Total,
			Pending: setting.Progress.Pending,
			Done:    setting.Progress.Done,
			Skipped: setting.Progress.Skipped,
			Failed:  setting.Progress.Failed,
		}
	}
	return result
}

// convertStorageMigrationSettingToStore only carries the fields a client is allowed to set. The
// state machine, the precheck result and the progress counts are server-owned: a client that
// could post state = READY would be able to skip straight past reconciliation.
func convertStorageMigrationSettingToStore(setting *v1pb.InstanceSetting_StorageMigrationSetting) *storepb.InstanceStorageMigrationSetting {
	if setting == nil {
		return nil
	}
	return &storepb.InstanceStorageMigrationSetting{
		TargetS3Config: convertS3ConfigToStore(setting.TargetS3Config),
	}
}

// prepareStorageMigrationSettingForUpdate turns a client's write into the full stored setting:
// it normalizes and validates the drafted target, keeps the server-owned fields under server
// control, and decides whether an existing precheck survives the edit.
func (s *APIV1Service) prepareStorageMigrationSettingForUpdate(ctx context.Context, updateSetting *storepb.InstanceSetting) error {
	incoming := updateSetting.GetStorageMigrationSetting()
	if incoming == nil {
		return status.Error(codes.InvalidArgument, "storage migration setting is required")
	}
	existing, err := s.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get current storage migration setting: %v", err)
	}

	// Once the copying has started the target is what the copied objects were written against,
	// so it can no longer be edited: the migration has to be abandoned and redrafted.
	switch existing.State {
	case storepb.InstanceStorageMigrationSetting_STATE_UNSPECIFIED,
		storepb.InstanceStorageMigrationSetting_DRAFT,
		storepb.InstanceStorageMigrationSetting_PRECHECKED:
	default:
		return status.Errorf(codes.FailedPrecondition,
			"the migration target cannot be changed in state %s: abandon the migration first", existing.State)
	}

	// An empty target is how a draft is abandoned.
	if incoming.TargetS3Config == nil {
		updateSetting.Value = &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{},
		}
		return nil
	}

	target := incoming.TargetS3Config
	// Same trimming as the live S3 config: pasted credentials carry whitespace, and it would be
	// signed as part of the request and come back as SignatureDoesNotMatch.
	target.AccessKeyId = strings.TrimSpace(target.AccessKeyId)
	target.AccessKeySecret = strings.TrimSpace(target.AccessKeySecret)
	target.Endpoint = strings.TrimSpace(target.Endpoint)
	target.Region = strings.TrimSpace(target.Region)
	target.Bucket = strings.TrimSpace(target.Bucket)
	target.RootPrefix = strings.Trim(strings.TrimSpace(target.RootPrefix), "/")

	// The secret is write-only, so a client editing an existing draft sends it back empty.
	if target.AccessKeySecret == "" {
		target.AccessKeySecret = existing.GetTargetS3Config().GetAccessKeySecret()
	}

	storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get storage setting: %v", err)
	}
	current := storageSetting.GetS3Config()
	if current == nil {
		return status.Error(codes.FailedPrecondition,
			"no S3 storage is configured, so there is nothing to migrate: configure S3 storage first")
	}
	if err := validateMigrationTarget(current, target); err != nil {
		return err
	}

	migration := &storepb.InstanceStorageMigrationSetting{
		State:          storepb.InstanceStorageMigrationSetting_DRAFT,
		TargetS3Config: target,
		CreateTime:     existing.CreateTime,
		UpdateTime:     timestamppb.Now(),
	}
	if migration.CreateTime == nil {
		migration.CreateTime = migration.UpdateTime
	}
	// A precheck is a statement about one specific target. If the target is untouched, keep it;
	// if anything about it changed, the statement no longer applies and the draft goes back to
	// needing a precheck.
	if proto.Equal(existing.GetTargetS3Config(), target) {
		migration.State = existing.State
		migration.Precheck = existing.Precheck
	}
	updateSetting.Value = &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: migration}
	return nil
}

func validateMigrationTarget(current, target *storepb.StorageS3Config) error {
	if target.Endpoint == "" {
		return status.Error(codes.InvalidArgument, "target endpoint is required")
	}
	if target.Bucket == "" {
		return status.Error(codes.InvalidArgument, "target bucket is required")
	}
	if target.AccessKeyId == "" || target.AccessKeySecret == "" {
		return status.Error(codes.InvalidArgument, "target access key id and secret are required")
	}
	// A migration that does not move anything is a no-op that would still freeze attachment
	// writes and rewrite every mapping, so it is refused rather than silently accepted.
	if target.Endpoint == current.Endpoint && target.Bucket == current.Bucket && target.RootPrefix == current.RootPrefix {
		return status.Error(codes.InvalidArgument,
			"the target is the current location: change the endpoint, the bucket or the root directory, or edit the connection fields directly instead")
	}
	return nil
}

// StartStorageMigration freezes attachment writes, builds the work list, and hands the copying to
// the background worker.
//
// Freezing before enqueuing is not an optimisation, it is the ordering that makes the work list
// complete: an upload accepted after the attachment table has been scanned would land in the old
// location and never be copied, and nothing later in the flow would notice.
func (s *APIV1Service) StartStorageMigration(ctx context.Context, _ *v1pb.StartStorageMigrationRequest) (*v1pb.InstanceSetting, error) {
	migration, err := s.requireAdminMigration(ctx)
	if err != nil {
		return nil, err
	}
	if migration.State != storepb.InstanceStorageMigrationSetting_PRECHECKED {
		return nil, status.Errorf(codes.FailedPrecondition,
			"the migration must pass a precheck before it can start (state %s)", migration.State)
	}
	if !migration.GetPrecheck().GetPassed() {
		return nil, status.Error(codes.FailedPrecondition, "the last precheck did not pass")
	}

	migration.State = storepb.InstanceStorageMigrationSetting_FROZEN
	migration.UpdateTime = timestamppb.Now()
	if _, err := s.saveMigration(ctx, migration); err != nil {
		return nil, err
	}

	total, err := storagemigration.Enqueue(ctx, s.Store, migration.TargetS3Config)
	if err != nil {
		// The gate is already closed, and leaving it closed with no work list would strand the
		// instance in a frozen state nobody asked for. Back out to where we started.
		migration.State = storepb.InstanceStorageMigrationSetting_PRECHECKED
		migration.LastError = err.Error()
		migration.UpdateTime = timestamppb.Now()
		if _, saveErr := s.saveMigration(ctx, migration); saveErr != nil {
			return nil, status.Errorf(codes.Internal, "failed to build the work list (%v) and failed to unfreeze: %v", err, saveErr)
		}
		return nil, status.Errorf(codes.Internal, "failed to build the migration work list: %v", err)
	}

	migration.State = storepb.InstanceStorageMigrationSetting_MIGRATING
	migration.LastError = ""
	migration.Progress = &storepb.InstanceStorageMigrationSetting_Progress{Total: int64(total), Pending: int64(total)}
	migration.UpdateTime = timestamppb.Now()
	return s.saveMigration(ctx, migration)
}

// RetryStorageMigration puts the failed rows back in the queue. Retrying is safe at any point
// because a copy is idempotent: an object already at the target with the right size is left
// alone rather than rewritten.
func (s *APIV1Service) RetryStorageMigration(ctx context.Context, _ *v1pb.RetryStorageMigrationRequest) (*v1pb.InstanceSetting, error) {
	migration, err := s.requireAdminMigration(ctx)
	if err != nil {
		return nil, err
	}
	if !attachmentWritesFrozenState(migration.State) {
		return nil, status.Errorf(codes.FailedPrecondition, "no migration is running (state %s)", migration.State)
	}

	// Pick up anything that was uploaded in the gap before the gate closed, too: retry is the
	// operator's "try to make this complete" button, and a missing row is as incomplete as a
	// failed one.
	if _, err := storagemigration.Enqueue(ctx, s.Store, migration.TargetS3Config); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to re-scan for attachments added since the migration started: %v", err)
	}

	failed := store.AttachmentMigrationStatusFailed
	jobs, err := s.Store.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{Status: &failed})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read the migration work list: %v", err)
	}
	pending := store.AttachmentMigrationStatusPending
	empty := ""
	for _, job := range jobs {
		if err := s.Store.UpdateAttachmentMigrationJob(ctx, &store.UpdateAttachmentMigrationJob{
			AttachmentID: job.AttachmentID,
			Status:       &pending,
			LastError:    &empty,
		}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to requeue attachment %d: %v", job.AttachmentID, err)
		}
	}

	migration.State = storepb.InstanceStorageMigrationSetting_MIGRATING
	migration.LastError = ""
	migration.UpdateTime = timestamppb.Now()
	return s.saveMigration(ctx, migration)
}

// SwitchStorageMigration points the instance at the target.
func (s *APIV1Service) SwitchStorageMigration(ctx context.Context, _ *v1pb.SwitchStorageMigrationRequest) (*v1pb.InstanceSetting, error) {
	migration, err := s.requireAdminMigration(ctx)
	if err != nil {
		return nil, err
	}
	if migration.State != storepb.InstanceStorageMigrationSetting_READY {
		return nil, status.Errorf(codes.FailedPrecondition,
			"the migration is not verified yet (state %s): every object has to be copied and reconciled first", migration.State)
	}
	// An upload that got through in the moment between closing the write gate and scanning the
	// attachment table is not in the work list, so no count would ever notice it -- and after the
	// switch its object would be looked for in the new bucket, where it never was. Re-running the
	// scan is cheap and turns that invisible hole into a visible pending row.
	added, err := storagemigration.Enqueue(ctx, s.Store, migration.TargetS3Config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to re-scan for attachments added since the migration started: %v", err)
	}
	if added > 0 {
		migration.State = storepb.InstanceStorageMigrationSetting_MIGRATING
		migration.UpdateTime = timestamppb.Now()
		if _, saveErr := s.saveMigration(ctx, migration); saveErr != nil {
			return nil, saveErr
		}
		return nil, status.Errorf(codes.FailedPrecondition,
			"%d attachments appeared after the work list was built and are being copied now; switch again once they are done", added)
	}

	counts, err := s.Store.CountAttachmentMigrationJobsByStatus(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to count the migration work list: %v", err)
	}
	// Skipped rows do not block: their object was already missing before the migration started,
	// and refusing on them would mean an instance with one historical broken link can never
	// migrate. Failed rows do block: those are objects that exist and did not arrive.
	if counts[store.AttachmentMigrationStatusFailed] > 0 {
		return nil, status.Errorf(codes.FailedPrecondition,
			"%d attachments did not reach the target: fix or retry them before switching", counts[store.AttachmentMigrationStatusFailed])
	}
	if counts[store.AttachmentMigrationStatusPending] > 0 {
		return nil, status.Errorf(codes.FailedPrecondition,
			"%d attachments have not been copied yet", counts[store.AttachmentMigrationStatusPending])
	}

	if err := storagemigration.Apply(ctx, s.Store, migration.TargetS3Config); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to switch to the migration target: %v", err)
	}
	slog.Info("attachment storage migration switched",
		slog.String("bucket", migration.TargetS3Config.GetBucket()),
		slog.String("rootPrefix", migration.TargetS3Config.GetRootPrefix()),
		slog.Int("copied", counts[store.AttachmentMigrationStatusDone]),
		slog.Int("skipped", counts[store.AttachmentMigrationStatusSkipped]))

	setting, err := s.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read the migration setting: %v", err)
	}
	return convertInstanceSettingFromStore(&storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: setting},
	}), nil
}

// AbandonStorageMigration drops the work list and unfreezes writes. Whatever was already copied
// stays at the target: deleting it would be the one thing this feature promises never to do
// automatically, and it is harmless -- the instance never looked at it.
func (s *APIV1Service) AbandonStorageMigration(ctx context.Context, _ *v1pb.AbandonStorageMigrationRequest) (*v1pb.InstanceSetting, error) {
	if _, err := s.requireAdminMigration(ctx); err != nil {
		return nil, err
	}
	if err := s.Store.ClearAttachmentMigrationJobs(ctx); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to clear the migration work list: %v", err)
	}
	return s.saveMigration(ctx, &storepb.InstanceStorageMigrationSetting{})
}

func (s *APIV1Service) requireAdminMigration(ctx context.Context) (*storepb.InstanceStorageMigrationSetting, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Error(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleAdmin {
		return nil, status.Error(codes.PermissionDenied, "permission denied")
	}
	migration, err := s.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get storage migration setting: %v", err)
	}
	return migration, nil
}

func (s *APIV1Service) saveMigration(ctx context.Context, migration *storepb.InstanceStorageMigrationSetting) (*v1pb.InstanceSetting, error) {
	saved, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: migration},
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save the storage migration setting: %v", err)
	}
	return convertInstanceSettingFromStore(saved), nil
}

// attachmentWritesFrozenState mirrors the store-side gate so the API can tell "a migration is
// running" from "one is being drafted" without a second read.
func attachmentWritesFrozenState(state storepb.InstanceStorageMigrationSetting_State) bool {
	switch state {
	case storepb.InstanceStorageMigrationSetting_FROZEN,
		storepb.InstanceStorageMigrationSetting_MIGRATING,
		storepb.InstanceStorageMigrationSetting_RECONCILING,
		storepb.InstanceStorageMigrationSetting_READY:
		return true
	default:
		return false
	}
}
