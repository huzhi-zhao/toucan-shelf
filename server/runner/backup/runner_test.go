package backup

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// The automatic backup schedule lives in the stored setting, not in the runner's ticker: an
// instance that restarts more often than the interval used to never back up at all.
func TestBackupDue(t *testing.T) {
	ctx := context.Background()

	configureS3 := func(t *testing.T, ts *store.Store) {
		_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_STORAGE,
			Value: &storepb.InstanceSetting_StorageSetting{
				StorageSetting: &storepb.InstanceStorageSetting{
					StorageType: storepb.InstanceStorageSetting_S3,
					S3Config:    &storepb.StorageS3Config{Bucket: "backups", Endpoint: "https://example.invalid"},
				},
			},
		})
		require.NoError(t, err)
	}
	recordAttempt := func(t *testing.T, ts *store.Store, at time.Time, success bool) {
		_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_BACKUP,
			Value: &storepb.InstanceSetting_BackupSetting{
				BackupSetting: &storepb.InstanceBackupSetting{
					PathTemplate:      store.DefaultInstanceBackupPathTemplate,
					LastBackupTime:    timestamppb.New(at),
					LastBackupSuccess: success,
				},
			},
		})
		require.NoError(t, err)
	}

	t.Run("no s3 configured", func(t *testing.T) {
		ts := teststore.NewTestingStore(ctx, t)
		defer ts.Close()
		due, err := (&Runner{Store: ts}).backupDue(ctx)
		require.NoError(t, err)
		assert.False(t, due, "an instance without S3 storage must not record a failed attempt every poll")
	})

	t.Run("never backed up", func(t *testing.T) {
		ts := teststore.NewTestingStore(ctx, t)
		defer ts.Close()
		configureS3(t, ts)
		due, err := (&Runner{Store: ts}).backupDue(ctx)
		require.NoError(t, err)
		assert.True(t, due)
	})

	t.Run("recent success", func(t *testing.T) {
		ts := teststore.NewTestingStore(ctx, t)
		defer ts.Close()
		configureS3(t, ts)
		recordAttempt(t, ts, time.Now().Add(-24*time.Hour), true)
		due, err := (&Runner{Store: ts}).backupDue(ctx)
		require.NoError(t, err)
		assert.False(t, due)
	})

	t.Run("interval elapsed since last success", func(t *testing.T) {
		ts := teststore.NewTestingStore(ctx, t)
		defer ts.Close()
		configureS3(t, ts)
		recordAttempt(t, ts, time.Now().Add(-backupInterval-time.Hour), true)
		due, err := (&Runner{Store: ts}).backupDue(ctx)
		require.NoError(t, err)
		assert.True(t, due, "a backup that came due while the process was down must be taken")
	})

	t.Run("last attempt failed", func(t *testing.T) {
		ts := teststore.NewTestingStore(ctx, t)
		defer ts.Close()
		configureS3(t, ts)
		recordAttempt(t, ts, time.Now().Add(-time.Minute), false)
		due, err := (&Runner{Store: ts}).backupDue(ctx)
		require.NoError(t, err)
		assert.True(t, due, "a failed attempt is retried on the next poll, not a week later")
	})
}
