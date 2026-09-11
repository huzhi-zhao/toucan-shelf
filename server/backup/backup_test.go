package backup

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	teststore "github.com/usememos/memos/store/test"
)

// Recording the outcome of a backup must not disturb the admin-configured path template.
// UpsertInstanceSetting replaces the whole setting value, so writing the status back from a
// freshly built message used to reset path_template to the default on every single backup.
func TestRunKeepsConfiguredPathTemplate(t *testing.T) {
	ctx := context.Background()
	ts := teststore.NewTestingStore(ctx, t)
	defer ts.Close()

	const customTemplate = "db-backups/{year}/{timestamp}.db.gz"
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_BACKUP,
		Value: &storepb.InstanceSetting_BackupSetting{
			BackupSetting: &storepb.InstanceBackupSetting{PathTemplate: customTemplate},
		},
	})
	require.NoError(t, err)

	// No S3 storage is configured here, so the backup fails and takes the failure-recording
	// path. That path is exactly where the template used to be lost.
	require.Error(t, Run(ctx, nil, ts))

	backupSetting, err := ts.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	assert.Equal(t, customTemplate, backupSetting.GetPathTemplate())
	assert.False(t, backupSetting.GetLastBackupSuccess())
	assert.NotNil(t, backupSetting.GetLastBackupTime())
	assert.NotEmpty(t, backupSetting.GetLastBackupError())
}

// A successful run clears the error message left by an earlier failure. There is no success
// case to assert here without an S3 endpoint, so this covers the inverse: a second failure
// overwrites the first one's message rather than appending to it.
func TestRunRecordsLatestFailure(t *testing.T) {
	ctx := context.Background()
	ts := teststore.NewTestingStore(ctx, t)
	defer ts.Close()

	require.Error(t, Run(ctx, nil, ts))
	first, err := ts.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	firstTime := first.GetLastBackupTime().AsTime()

	require.Error(t, Run(ctx, nil, ts))
	second, err := ts.GetInstanceBackupSetting(ctx)
	require.NoError(t, err)
	assert.Equal(t, first.GetLastBackupError(), second.GetLastBackupError())
	assert.False(t, second.GetLastBackupTime().AsTime().Before(firstTime))
}
