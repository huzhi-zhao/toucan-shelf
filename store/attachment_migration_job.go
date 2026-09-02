package store

import (
	"context"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"

	storepb "github.com/usememos/memos/proto/gen/store"
)

// One attachment storage migration's work list. See
// docs/dev/design/20260902-attachment-storage-migration.md.
//
// The table is deliberately a scratch space rather than a log: it is filled when a migration
// starts and emptied when it is switched or abandoned. Anything worth keeping (when, from where,
// to where, how many) is written to the STORAGE_MIGRATION instance setting instead.

const (
	// AttachmentMigrationStatusPending is a row that has not been copied yet.
	AttachmentMigrationStatusPending = "pending"
	// AttachmentMigrationStatusDone is a row whose object is present at the target.
	AttachmentMigrationStatusDone = "done"
	// AttachmentMigrationStatusSkipped is a row whose source object does not exist. The
	// attachment was already broken before the migration started, so it must not block it --
	// but it is recorded rather than silently passed over.
	AttachmentMigrationStatusSkipped = "skipped"
	// AttachmentMigrationStatusFailed is a row that could not be copied for any other reason.
	// Unlike skipped, this does block the switch.
	AttachmentMigrationStatusFailed = "failed"
)

type AttachmentMigrationJob struct {
	AttachmentID int32
	SourceKey    string
	TargetKey    string
	Status       string
	Size         int64
	Attempts     int32
	LastError    string
	CreatedTs    int64
	UpdatedTs    int64
}

type FindAttachmentMigrationJob struct {
	AttachmentID *int32
	Status       *string
	Limit        *int
}

type UpdateAttachmentMigrationJob struct {
	AttachmentID int32
	Status       *string
	TargetKey    *string
	Size         *int64
	Attempts     *int32
	LastError    *string
}

// AttachmentStorageRewrite is one attachment's new home, applied at switch time.
type AttachmentStorageRewrite struct {
	AttachmentID int32
	Reference    string
	Payload      *storepb.AttachmentPayload
}

// AttachmentStorageRewriteRow is the marshalled form the driver writes.
type AttachmentStorageRewriteRow struct {
	AttachmentID int32
	Reference    string
	Payload      string
}

func (s *Store) UpsertAttachmentMigrationJobs(ctx context.Context, jobs []*AttachmentMigrationJob) error {
	return s.driver.UpsertAttachmentMigrationJobs(ctx, jobs)
}

func (s *Store) ListAttachmentMigrationJobs(ctx context.Context, find *FindAttachmentMigrationJob) ([]*AttachmentMigrationJob, error) {
	return s.driver.ListAttachmentMigrationJobs(ctx, find)
}

func (s *Store) UpdateAttachmentMigrationJob(ctx context.Context, update *UpdateAttachmentMigrationJob) error {
	return s.driver.UpdateAttachmentMigrationJob(ctx, update)
}

func (s *Store) CountAttachmentMigrationJobsByStatus(ctx context.Context) (map[string]int, error) {
	return s.driver.CountAttachmentMigrationJobsByStatus(ctx)
}

func (s *Store) ClearAttachmentMigrationJobs(ctx context.Context) error {
	return s.driver.ClearAttachmentMigrationJobs(ctx)
}

// ApplyAttachmentStorageMigration is the switch: every attachment's object key is rewritten to
// its new location, the instance's S3 configuration becomes the migration target, the migration
// setting is cleared and the work list is dropped -- all in one transaction.
//
// It is one transaction because the alternative has no safe ordering. Rewriting keys first leaves
// every attachment pointing at the new bucket while the instance still reads from the old one;
// swapping the config first leaves old keys being looked up in the new bucket. Either way a crash
// in between is a site-wide outage, and there is no state to recover from because both halves
// look plausible on their own.
func (s *Store) ApplyAttachmentStorageMigration(ctx context.Context, rewrites []*AttachmentStorageRewrite, storageSetting *storepb.InstanceStorageSetting) error {
	settingValue, err := marshalInstanceSettingValue(&storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: storageSetting},
	})
	if err != nil {
		return errors.Wrap(err, "failed to marshal the new storage setting")
	}
	migrationValue, err := marshalInstanceSettingValue(&storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{},
		},
	})
	if err != nil {
		return errors.Wrap(err, "failed to marshal the cleared migration setting")
	}

	rows := make([]*AttachmentStorageRewriteRow, 0, len(rewrites))
	for _, rewrite := range rewrites {
		payload, err := protojson.Marshal(rewrite.Payload)
		if err != nil {
			return errors.Wrapf(err, "failed to marshal payload of attachment %d", rewrite.AttachmentID)
		}
		rows = append(rows, &AttachmentStorageRewriteRow{
			AttachmentID: rewrite.AttachmentID,
			Reference:    rewrite.Reference,
			Payload:      string(payload),
		})
	}

	settings := []*InstanceSetting{
		{Name: storepb.InstanceSettingKey_STORAGE.String(), Value: settingValue},
		{Name: storepb.InstanceSettingKey_STORAGE_MIGRATION.String(), Value: migrationValue},
	}
	if err := s.driver.ApplyAttachmentStorageMigration(ctx, rows, settings); err != nil {
		return errors.Wrap(err, "failed to apply the attachment storage migration")
	}

	// The settings were written underneath the cache, so drop what it holds. Leaving a stale
	// storage setting behind would keep serving attachments from the old bucket until restart.
	s.instanceSettingCache.Delete(ctx, storepb.InstanceSettingKey_STORAGE.String())
	s.instanceSettingCache.Delete(ctx, storepb.InstanceSettingKey_STORAGE_MIGRATION.String())
	return nil
}

// ErrAttachmentWritesFrozen is returned by every path that would write attachment bytes while a
// storage migration is running.
var ErrAttachmentWritesFrozen = errors.New("attachment storage migration is in progress: uploading, replacing and deleting attachments is paused until it finishes or is abandoned")

// AttachmentWritesFrozen reports whether an attachment storage migration currently holds the
// write gate closed.
//
// The gate has to live on the server, not on a disabled button: memogit and the MCP server both
// create attachments, and neither goes near the web UI. Reads are deliberately unaffected -- the
// whole point of copying instead of moving is that the old location keeps serving until the
// switch.
func (s *Store) AttachmentWritesFrozen(ctx context.Context) (bool, error) {
	migration, err := s.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		return false, err
	}
	return attachmentWritesFrozenForState(migration.GetState()), nil
}

func attachmentWritesFrozenForState(state storepb.InstanceStorageMigrationSetting_State) bool {
	switch state {
	case storepb.InstanceStorageMigrationSetting_FROZEN,
		storepb.InstanceStorageMigrationSetting_MIGRATING,
		storepb.InstanceStorageMigrationSetting_RECONCILING,
		storepb.InstanceStorageMigrationSetting_READY:
		return true
	default:
		// DRAFT and PRECHECKED have not touched a single object yet, so there is nothing to
		// keep consistent and no reason to stop people working.
		return false
	}
}

// EnsureAttachmentWritesAllowed is the guard itself, for call sites that only want to abort.
func (s *Store) EnsureAttachmentWritesAllowed(ctx context.Context) error {
	frozen, err := s.AttachmentWritesFrozen(ctx)
	if err != nil {
		return err
	}
	if frozen {
		return ErrAttachmentWritesFrozen
	}
	return nil
}
