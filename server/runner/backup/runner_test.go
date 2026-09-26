package backup

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestBackupDue(t *testing.T) {
	now := time.Date(2026, time.September, 15, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name    string
		last    time.Time
		success bool
		want    bool
	}{
		{"recent success", now.Add(-backupInterval + time.Second), true, false},
		{"weekly success due", now.Add(-backupInterval), true, true},
		{"recent failure", now.Add(-retryInterval + time.Second), false, false},
		{"failed attempt due", now.Add(-retryInterval), false, true},
		{"future timestamp", now.Add(time.Hour), true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, backupDue(tc.last, tc.success, now))
		})
	}
}

func TestRunIfDueSkipsUnconfiguredAndRecentBackup(t *testing.T) {
	ctx := context.Background()
	stores := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { _ = stores.Close() })
	runner := NewRunner(&profile.Profile{Driver: "sqlite"}, stores)
	now := time.Now()

	runner.runIfDue(ctx, now)
	setting, err := stores.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	require.Nil(t, setting.LastBackupTime, "unconfigured S3 must not record a failed backup")

	_, err = stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: &storepb.InstanceStorageSetting{
			StorageType: storepb.InstanceStorageSetting_S3,
			S3Config: &storepb.StorageS3Config{
				Endpoint: "http://127.0.0.1:1", Region: "us-east-1", Bucket: "test",
				AccessKeyId: "test", AccessKeySecret: "test", UsePathStyle: true,
			},
		}},
	})
	require.NoError(t, err)
	last := timestamppb.New(now.Add(-backupInterval + time.Hour))
	_, err = stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_BACKUP,
		Value: &storepb.InstanceSetting_BackupSetting{BackupSetting: &storepb.InstanceBackupSetting{
			LastBackupTime: last, LastBackupSuccess: true,
		}},
	})
	require.NoError(t, err)

	runner.runIfDue(ctx, now)
	setting, err = stores.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, last.AsTime().Unix(), setting.LastBackupTime.AsTime().Unix(), "recent backups must not be repeated after restart")
}

func TestRunChecksForDueBackupAtStartup(t *testing.T) {
	ctx := context.Background()
	stores := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { _ = stores.Close() })
	uploads := make(chan struct{}, 1)
	s3Server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		uploads <- struct{}{}
		w.Header().Set("ETag", `"test-etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer s3Server.Close()
	_, err := stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: &storepb.InstanceStorageSetting{
			StorageType: storepb.InstanceStorageSetting_S3,
			S3Config: &storepb.StorageS3Config{
				Endpoint: s3Server.URL, Region: "us-east-1", Bucket: "test",
				AccessKeyId: "test", AccessKeySecret: "test", UsePathStyle: true,
			},
		}},
	})
	require.NoError(t, err)

	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewRunner(&profile.Profile{Driver: "sqlite"}, stores).Run(runCtx)
	}()
	defer func() {
		cancel()
		<-done
	}()
	select {
	case <-uploads:
	case <-time.After(5 * time.Second):
		t.Fatal("due backup did not run at startup")
	}
	require.Eventually(t, func() bool {
		setting, getErr := stores.GetInstanceBackupSetting(ctx)
		return getErr == nil && setting.LastBackupSuccess && setting.LastBackupTime != nil
	}, 5*time.Second, 20*time.Millisecond, "startup backup status was not recorded")
}
