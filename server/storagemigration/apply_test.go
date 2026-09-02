package storagemigration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// The switch is the one moment the attachment table is touched. Half of it applied is a
// site-wide outage, so what it writes -- and what it refuses to write -- is worth pinning down.

func setLiveS3(ctx context.Context, t *testing.T, ts *store.Store, bucket, rootPrefix string) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{
				StorageType:      storepb.InstanceStorageSetting_S3,
				FilenameTemplate: "{timestamp}_{uuid}_{filename}",
				S3Config: &storepb.StorageS3Config{
					Endpoint: "https://s3.example.com", Bucket: bucket, RootPrefix: rootPrefix,
					Region: "us-east-1", AccessKeyId: "key", AccessKeySecret: "secret",
				},
			},
		},
	})
	require.NoError(t, err)
}

func TestApplyRewritesKeysAndSwapsTheLocation(t *testing.T) {
	ctx := context.Background()
	ts := newTestStore(ctx, t)
	user, err := ts.CreateUser(ctx, &store.User{
		Username: "owner", Role: store.RoleAdmin, Email: "owner@example.com", Nickname: "owner", PasswordHash: "hash",
	})
	require.NoError(t, err)
	setLiveS3(ctx, t, ts, "kb", "assets")

	copied := createS3Attachment(ctx, t, ts, "copied", user.ID, nil, "assets/_unassigned/a.png")
	broken := createS3Attachment(ctx, t, ts, "broken", user.ID, nil, "assets/_unassigned/b.png")
	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: copied.ID, SourceKey: "assets/_unassigned/a.png", TargetKey: "shelf/_unassigned/a.png", Status: store.AttachmentMigrationStatusDone},
		// A row whose source object was already gone. It is rewritten too: the attachment is
		// broken either way, and leaving one key in the old layout would mean "where are the
		// attachments" no longer has a single answer.
		{AttachmentID: broken.ID, SourceKey: "assets/_unassigned/b.png", TargetKey: "shelf/_unassigned/b.png", Status: store.AttachmentMigrationStatusSkipped},
	}))

	target := &storepb.StorageS3Config{
		Endpoint: "https://s3.example.com", Bucket: "kb-new", RootPrefix: "shelf",
		Region: "us-east-1", AccessKeyId: "key", AccessKeySecret: "secret",
	}
	require.NoError(t, Apply(ctx, ts, target))

	for _, tc := range []struct {
		id   int32
		want string
	}{{copied.ID, "shelf/_unassigned/a.png"}, {broken.ID, "shelf/_unassigned/b.png"}} {
		id := tc.id
		stored, err := ts.GetAttachment(ctx, &store.FindAttachment{ID: &id})
		require.NoError(t, err)
		require.Equal(t, tc.want, stored.Payload.GetS3Object().GetKey())
		require.Equal(t, tc.want, stored.Reference)
		// The snapshot is the fallback if the instance ever stops being an S3 instance, so it
		// has to describe the new location too.
		require.Equal(t, "kb-new", stored.Payload.GetS3Object().GetS3Config().GetBucket())
	}

	storageSetting, err := ts.GetInstanceStorageSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, "kb-new", storageSetting.S3Config.Bucket)
	require.Equal(t, "shelf", storageSetting.S3Config.RootPrefix)
	// Unrelated storage settings survive the swap.
	require.Equal(t, "{timestamp}_{uuid}_{filename}", storageSetting.FilenameTemplate)

	migration, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, storepb.InstanceStorageMigrationSetting_STATE_UNSPECIFIED, migration.State)

	jobs, err := ts.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{})
	require.NoError(t, err)
	require.Empty(t, jobs)
}

func TestApplyLeavesFailedRowsAlone(t *testing.T) {
	ctx := context.Background()
	ts := newTestStore(ctx, t)
	user, err := ts.CreateUser(ctx, &store.User{
		Username: "owner", Role: store.RoleAdmin, Email: "owner@example.com", Nickname: "owner", PasswordHash: "hash",
	})
	require.NoError(t, err)
	setLiveS3(ctx, t, ts, "kb", "assets")

	failed := createS3Attachment(ctx, t, ts, "failed", user.ID, nil, "assets/_unassigned/a.png")
	require.NoError(t, ts.UpsertAttachmentMigrationJobs(ctx, []*store.AttachmentMigrationJob{
		{AttachmentID: failed.ID, SourceKey: "assets/_unassigned/a.png", TargetKey: "shelf/_unassigned/a.png", Status: store.AttachmentMigrationStatusFailed},
	}))

	// SwitchStorageMigration refuses to get here at all, but if it ever did, pointing an
	// attachment at an object that was never copied is the one outcome worth guarding twice.
	require.NoError(t, Apply(ctx, ts, &storepb.StorageS3Config{Bucket: "kb-new", RootPrefix: "shelf"}))
	stored, err := ts.GetAttachment(ctx, &store.FindAttachment{ID: &failed.ID})
	require.NoError(t, err)
	require.Equal(t, "assets/_unassigned/a.png", stored.Payload.GetS3Object().GetKey())
}
