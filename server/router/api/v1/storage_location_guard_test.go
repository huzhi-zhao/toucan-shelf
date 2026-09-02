package v1

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// Changing bucket/root_prefix in place leaves every existing object at its old key while the
// read path resolves new keys, so the whole instance 404s silently. These tests pin the gate
// that turns that into an explicit "run a migration instead".

func setCurrentS3Location(ctx context.Context, t *testing.T, ts *store.Store, endpoint, bucket, rootPrefix string) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{
				StorageType:      storepb.InstanceStorageSetting_S3,
				FilenameTemplate: "{timestamp}_{uuid}_{filename}",
				S3Config: &storepb.StorageS3Config{
					Bucket:     bucket,
					RootPrefix: rootPrefix,
					Endpoint:   endpoint,
					Region:     "us-east-1",
				},
			},
		},
	})
	require.NoError(t, err)
}

func nextStorageSetting(endpoint, bucket, rootPrefix string) *storepb.InstanceStorageSetting {
	return &storepb.InstanceStorageSetting{
		StorageType:      storepb.InstanceStorageSetting_S3,
		FilenameTemplate: "{timestamp}_{uuid}_{filename}",
		S3Config: &storepb.StorageS3Config{
			Bucket:     bucket,
			RootPrefix: rootPrefix,
			Endpoint:   endpoint,
			Region:     "us-east-1",
		},
	}
}

func createS3Attachment(ctx context.Context, t *testing.T, ts *store.Store, creatorID int32) {
	t.Helper()
	_, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:         "s3attachment",
		CreatorID:   creatorID,
		Filename:    "a.png",
		Type:        "image/png",
		Size:        3,
		StorageType: storepb.AttachmentStorageType_S3,
		Reference:   "assets/kb/1_x_a.png",
	})
	require.NoError(t, err)
}

func newStorageGuardService(ctx context.Context, t *testing.T) (*APIV1Service, *store.Store) {
	t.Helper()
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("storage location guard tests run against sqlite")
	}
	return newAttachmentTestService(ctx, t)
}

func TestGuardS3StorageLocationAllowsConnectionOnlyChanges(t *testing.T) {
	ctx := context.Background()
	s, ts := newStorageGuardService(ctx, t)
	setCurrentS3Location(ctx, t, ts, "https://s3.example.com", "kb", "assets")
	createS3Attachment(ctx, t, ts, createTestUser(ctx, t, ts, "owner", store.RoleUser).ID)

	// Same location, rotated credentials and a corrected region: these only say how to reach the
	// same objects, so they must stay editable even with a full bucket. Key rotation is routine
	// and must never require a migration.
	next := nextStorageSetting("https://s3.example.com", "kb", "assets")
	next.S3Config.AccessKeyId = "rotated"
	next.S3Config.AccessKeySecret = "rotated-secret"
	next.S3Config.Region = "eu-west-1"
	next.S3Config.UsePathStyle = true
	require.NoError(t, s.guardS3StorageLocation(ctx, next))
}

func TestGuardS3StorageLocationAllowsMoveWhenNothingStoredThere(t *testing.T) {
	ctx := context.Background()
	s, ts := newStorageGuardService(ctx, t)
	setCurrentS3Location(ctx, t, ts, "https://s3.example.com", "kb", "assets")

	// No S3 attachment rows: an admin is still setting the bucket up, nothing can break.
	require.NoError(t, s.guardS3StorageLocation(ctx, nextStorageSetting("https://other.example.com", "another-bucket", "shelf")))

	// A local attachment is not stored in S3 and must not lock the bucket down either.
	owner := createTestUser(ctx, t, ts, "owner", store.RoleUser)
	_, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:         "localattachment",
		CreatorID:   owner.ID,
		Filename:    "a.png",
		Type:        "image/png",
		Size:        3,
		StorageType: storepb.AttachmentStorageType_LOCAL,
		Reference:   "assets/a.png",
	})
	require.NoError(t, err)
	require.NoError(t, s.guardS3StorageLocation(ctx, nextStorageSetting("https://other.example.com", "another-bucket", "shelf")))
}

func TestGuardS3StorageLocationRejectsInPlaceMoves(t *testing.T) {
	ctx := context.Background()
	s, ts := newStorageGuardService(ctx, t)
	setCurrentS3Location(ctx, t, ts, "https://s3.example.com", "kb", "assets")
	createS3Attachment(ctx, t, ts, createTestUser(ctx, t, ts, "owner", store.RoleUser).ID)

	for _, tt := range []struct {
		name string
		next *storepb.InstanceStorageSetting
	}{
		{"endpoint change", nextStorageSetting("https://minio.internal", "kb", "assets")},
		{"bucket change", nextStorageSetting("https://s3.example.com", "another-bucket", "assets")},
		{"root prefix change", nextStorageSetting("https://s3.example.com", "kb", "shelf")},
		{"root prefix emptied to the bucket root", nextStorageSetting("https://s3.example.com", "kb", "")},
		{
			// Dropping the S3 config and re-adding it elsewhere would otherwise be a way
			// around the bucket check.
			"s3 config removed",
			&storepb.InstanceStorageSetting{StorageType: storepb.InstanceStorageSetting_LOCAL},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := s.guardS3StorageLocation(ctx, tt.next)
			require.Equal(t, codes.FailedPrecondition, status.Code(err))
		})
	}
}
