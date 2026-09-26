package backup

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestRunPreservesCustomPathTemplate(t *testing.T) {
	ctx := context.Background()
	stores := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { _ = stores.Close() })
	const template = "custom/backups/{timestamp}_{uuid}.db.gz"
	_, err := stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_BACKUP,
		Value: &storepb.InstanceSetting_BackupSetting{BackupSetting: &storepb.InstanceBackupSetting{
			PathTemplate: template,
		}},
	})
	require.NoError(t, err)

	// A failed run must update status without resetting the admin's template.
	err = Run(ctx, &profile.Profile{Driver: "sqlite"}, stores)
	require.Error(t, err)
	setting, err := stores.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, template, setting.PathTemplate)
	require.NotNil(t, setting.LastBackupTime)
	require.False(t, setting.LastBackupSuccess)
	require.NotEmpty(t, setting.LastBackupError)

	uploadedKeys := make(chan string, 1)
	s3Server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		uploadedKeys <- strings.TrimPrefix(r.URL.Path, "/backup-test/")
		w.Header().Set("ETag", `"test-etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer s3Server.Close()
	_, err = stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: &storepb.InstanceStorageSetting{
			StorageType: storepb.InstanceStorageSetting_S3,
			S3Config: &storepb.StorageS3Config{
				Endpoint:        s3Server.URL,
				Region:          "us-east-1",
				Bucket:          "backup-test",
				AccessKeyId:     "test-key",
				AccessKeySecret: "test-secret",
				UsePathStyle:    true,
			},
		}},
	})
	require.NoError(t, err)

	require.NoError(t, Run(ctx, &profile.Profile{Driver: "sqlite"}, stores))
	setting, err = stores.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, template, setting.PathTemplate)
	require.True(t, setting.LastBackupSuccess)
	require.Empty(t, setting.LastBackupError)
	uploadedKey := <-uploadedKeys
	require.True(t, strings.HasPrefix(uploadedKey, "custom/backups/"), "uploaded key: %q", uploadedKey)
}
