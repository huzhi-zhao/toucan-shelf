package storagemigration

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func newRunnerTestStore(ctx context.Context, t *testing.T) *store.Store {
	t.Helper()
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("storage migration runner tests run against sqlite")
	}
	return teststore.NewTestingStore(ctx, t)
}

func saveMigration(ctx context.Context, t *testing.T, ts *store.Store, state storepb.InstanceStorageMigrationSetting_State) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{
				State: state,
				TargetS3Config: &storepb.StorageS3Config{
					Endpoint: "https://s3.example.com", Bucket: "kb-new", RootPrefix: "shelf",
					Region: "us-east-1", AccessKeyId: "key", AccessKeySecret: "secret",
				},
			},
		},
	})
	require.NoError(t, err)
}

func saveLiveS3(ctx context.Context, t *testing.T, ts *store.Store) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{
				StorageType: storepb.InstanceStorageSetting_S3,
				S3Config: &storepb.StorageS3Config{
					Endpoint: "https://s3.example.com", Bucket: "kb", RootPrefix: "assets",
					Region: "us-east-1", AccessKeyId: "key", AccessKeySecret: "secret",
				},
			},
		},
	})
	require.NoError(t, err)
}

// An empty work list walks the whole state machine without touching S3, which is enough to pin
// down the phase transitions and the progress write-back.
func TestRunnerAdvancesThroughThePhases(t *testing.T) {
	ctx := context.Background()
	ts := newRunnerTestStore(ctx, t)
	saveLiveS3(ctx, t, ts)
	saveMigration(ctx, t, ts, storepb.InstanceStorageMigrationSetting_MIGRATING)
	runner := NewRunner(ts)

	runner.RunOnce(ctx)
	migration, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_RECONCILING, migration.State)

	runner.RunOnce(ctx)
	migration, err = ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_READY, migration.State)
	require.NotNil(t, migration.Progress)

	// READY is the worker's terminal state: the switch is the operator's call, not its own.
	runner.RunOnce(ctx)
	migration, err = ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_READY, migration.State)
}

func TestRunnerReportsCountsFromTheWorkList(t *testing.T) {
	ctx := context.Background()
	ts := newRunnerTestStore(ctx, t)
	saveLiveS3(ctx, t, ts)
	saveMigration(ctx, t, ts, storepb.InstanceStorageMigrationSetting_RECONCILING)
	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: 1, Status: store.AttachmentMigrationStatusSkipped},
		{AttachmentID: 2, Status: store.AttachmentMigrationStatusFailed},
	}))

	NewRunner(ts).RunOnce(ctx)
	migration, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(2), migration.Progress.Total)
	require.Equal(t, int64(1), migration.Progress.Skipped)
	require.Equal(t, int64(1), migration.Progress.Failed)
	// Reconciliation finishing does not mean the migration is clean -- READY only means it has
	// been checked. The failed row is what the switch refuses on.
	require.Equal(t, storepb.InstanceStorageMigrationSetting_READY, migration.State)
}

func TestRunnerIgnoresInstancesWithNoMigration(t *testing.T) {
	ctx := context.Background()
	ts := newRunnerTestStore(ctx, t)
	runner := NewRunner(ts)

	// Nearly every instance, nearly all the time: no migration setting at all.
	runner.RunOnce(ctx)
	migration, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_STATE_UNSPECIFIED, migration.State)

	// A draft is not the worker's business either: nothing has been copied yet.
	saveMigration(ctx, t, ts, storepb.InstanceStorageMigrationSetting_DRAFT)
	runner.RunOnce(ctx)
	migration, err = ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_DRAFT, migration.State)
	require.Nil(t, migration.Progress)
}
