package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/protobuf/field_mask"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// While a migration is copying, anything that writes attachment bytes has to be refused on the
// server. The frontend is not the gate: memogit and the MCP server both create attachments.

func setMigrationState(ctx context.Context, t *testing.T, ts *store.Store, state storepb.InstanceStorageMigrationSetting_State) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{
				State: state,
				TargetS3Config: &storepb.StorageS3Config{
					Endpoint: "https://s3.example.com", Bucket: "kb-new", RootPrefix: "assets",
					Region: "us-east-1", AccessKeyId: "key", AccessKeySecret: "secret",
				},
			},
		},
	})
	require.NoError(t, err)
}

func TestAttachmentWritesAreFrozenDuringMigration(t *testing.T) {
	ctx := context.Background()
	// Database-backed storage on purpose: the gate is about the migration, not about which
	// backend the bytes would have gone to, and this keeps the test off the network.
	s, ts := newAttachmentTestService(ctx, t)
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	attachment := createSVGAttachment(ctx, t, ts, owner.ID, false)
	authCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)

	// Drafting has copied nothing yet, so there is nothing to keep consistent.
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_DRAFT)
	_, err := s.CreateAttachment(authCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "n.png", Type: "image/png", Content: []byte("png")},
	})
	require.NoError(t, err)

	for _, state := range []storepb.InstanceStorageMigrationSetting_State{
		storepb.InstanceStorageMigrationSetting_FROZEN,
		storepb.InstanceStorageMigrationSetting_MIGRATING,
		storepb.InstanceStorageMigrationSetting_RECONCILING,
		storepb.InstanceStorageMigrationSetting_READY,
	} {
		t.Run(state.String(), func(t *testing.T) {
			setMigrationState(ctx, t, ts, state)

			// New bytes would land in the old location after it has already been scanned. The
			// refusal has to be recognisable, not a generic internal error: during a migration
			// this is the expected answer and "try again later" is the right advice.
			_, err := s.CreateAttachment(authCtx, &v1pb.CreateAttachmentRequest{
				Attachment: &v1pb.Attachment{Filename: "n.png", Type: "image/png", Content: []byte("png")},
			})
			require.Equal(t, codes.FailedPrecondition, status.Code(err))

			// An in-place overwrite would write to one side of the copy and leave the other stale.
			_, err = s.UpdateAttachment(authCtx, &v1pb.UpdateAttachmentRequest{
				Attachment: &v1pb.Attachment{Name: "attachments/" + attachment.UID, Content: []byte(drawioSVG)},
				UpdateMask: &field_mask.FieldMask{Paths: []string{"content"}},
			})
			require.Equal(t, codes.FailedPrecondition, status.Code(err))

			// Deleting leaves either a row without its object or an object without its row.
			err = s.Store.DeleteAttachmentStorage(ctx, attachment)
			require.ErrorIs(t, err, store.ErrAttachmentWritesFrozen)
		})
	}

	// Once the migration is gone, everything works again.
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_STATE_UNSPECIFIED)
	_, err = s.CreateAttachment(authCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "n.png", Type: "image/png", Content: []byte("png")},
	})
	require.NoError(t, err)
}

func TestStorageMigrationLifecycleGuards(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	admin := createTestUser(ctx, t, ts, "admin", store.RoleAdmin)
	adminCtx := context.WithValue(ctx, auth.UserIDContextKey, admin.ID)

	// Starting without a passed precheck would freeze the instance on the strength of an
	// untested target.
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_DRAFT)
	_, err := s.StartStorageMigration(adminCtx, &v1pb.StartStorageMigrationRequest{})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))

	// PRECHECKED, but the recorded precheck failed.
	migration, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	migration.State = storepb.InstanceStorageMigrationSetting_PRECHECKED
	migration.Precheck = &storepb.InstanceStorageMigrationSetting_PrecheckResult{Passed: false, Error: "no write permission"}
	_, err = ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: migration},
	})
	require.NoError(t, err)
	_, err = s.StartStorageMigration(adminCtx, &v1pb.StartStorageMigrationRequest{})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))

	// Switching before everything is copied and verified.
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_MIGRATING)
	_, err = s.SwitchStorageMigration(adminCtx, &v1pb.SwitchStorageMigrationRequest{})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestSwitchIsBlockedByFailuresButNotBySkips(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	admin := createTestUser(ctx, t, ts, "admin", store.RoleAdmin)
	adminCtx := context.WithValue(ctx, auth.UserIDContextKey, admin.ID)
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_READY)

	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: 9001, SourceKey: "assets/a.png", TargetKey: "shelf/a.png", Status: store.AttachmentMigrationStatusFailed},
	}))
	_, err := s.SwitchStorageMigration(adminCtx, &v1pb.SwitchStorageMigrationRequest{})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))

	// A source object that was already missing is not a reason to refuse: the attachment was
	// broken before the migration, and blocking on it would mean an instance with one historical
	// broken link can never migrate at all.
	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: 9001, SourceKey: "assets/a.png", TargetKey: "shelf/a.png", Status: store.AttachmentMigrationStatusSkipped},
	}))
	_, err = s.SwitchStorageMigration(adminCtx, &v1pb.SwitchStorageMigrationRequest{})
	require.NoError(t, err)

	// The switch unfreezes writes by clearing the migration.
	frozen, err := ts.AttachmentWritesFrozen(ctx)
	require.NoError(t, err)
	require.False(t, frozen)
}

func TestAbandonClearsTheWorkListAndUnfreezes(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	admin := createTestUser(ctx, t, ts, "admin", store.RoleAdmin)
	adminCtx := context.WithValue(ctx, auth.UserIDContextKey, admin.ID)
	setMigrationState(ctx, t, ts, storepb.InstanceStorageMigrationSetting_MIGRATING)
	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: 9001, SourceKey: "assets/a.png", TargetKey: "shelf/a.png", Status: store.AttachmentMigrationStatusDone},
	}))

	_, err := s.AbandonStorageMigration(adminCtx, &v1pb.AbandonStorageMigrationRequest{})
	require.NoError(t, err)

	jobs, err := ts.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{})
	require.NoError(t, err)
	require.Empty(t, jobs)
	frozen, err := ts.AttachmentWritesFrozen(ctx)
	require.NoError(t, err)
	require.False(t, frozen)
}
