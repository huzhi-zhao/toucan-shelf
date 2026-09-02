package v1

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// Drafting a migration target is the only part of the flow a client writes to. These tests pin
// down what it is allowed to say and what stays under server control.

func draftUpdate(target *storepb.StorageS3Config) *storepb.InstanceSetting {
	return &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{TargetS3Config: target},
		},
	}
}

func targetConfig(endpoint, bucket, rootPrefix string) *storepb.StorageS3Config {
	return &storepb.StorageS3Config{
		Endpoint:        endpoint,
		Bucket:          bucket,
		RootPrefix:      rootPrefix,
		Region:          "us-east-1",
		AccessKeyId:     "key",
		AccessKeySecret: "secret",
	}
}

func newMigrationTestService(ctx context.Context, t *testing.T) (*APIV1Service, *store.Store) {
	t.Helper()
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("storage migration tests run against sqlite")
	}
	s, ts := newAttachmentTestService(ctx, t)
	setCurrentS3Location(ctx, t, ts, "https://s3.example.com", "kb", "assets")
	return s, ts
}

func TestPrepareStorageMigrationDraft(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)

	update := draftUpdate(targetConfig("https://s3.example.com", "kb-new", "assets/"))
	require.NoError(t, s.prepareStorageMigrationSettingForUpdate(ctx, update))

	drafted := update.GetStorageMigrationSetting()
	require.Equal(t, storepb.InstanceStorageMigrationSetting_DRAFT, drafted.State)
	// Stray slashes must not survive: the location comparison is a string comparison, and
	// "assets/" reading as different from "assets" would let a no-op migration through.
	require.Equal(t, "assets", drafted.TargetS3Config.RootPrefix)
	require.NotNil(t, drafted.CreateTime)
	require.NotNil(t, drafted.UpdateTime)

	_, err := ts.UpsertInstanceSetting(ctx, update)
	require.NoError(t, err)
	stored, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, "kb-new", stored.TargetS3Config.Bucket)
}

func TestPrepareStorageMigrationDraftRejectsBadTargets(t *testing.T) {
	ctx := context.Background()
	s, _ := newMigrationTestService(ctx, t)

	for _, tt := range []struct {
		name   string
		target *storepb.StorageS3Config
	}{
		// Nothing moves, but the flow would still freeze uploads and rewrite every mapping.
		{"same location", targetConfig("https://s3.example.com", "kb", "assets")},
		{"same location with a stray slash", targetConfig("https://s3.example.com", "kb", "/assets/")},
		{"no endpoint", targetConfig("", "kb-new", "assets")},
		{"no bucket", targetConfig("https://s3.example.com", "", "assets")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := s.prepareStorageMigrationSettingForUpdate(ctx, draftUpdate(tt.target))
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}

	noKey := targetConfig("https://s3.example.com", "kb-new", "assets")
	noKey.AccessKeyId = ""
	require.Equal(t, codes.InvalidArgument, status.Code(s.prepareStorageMigrationSettingForUpdate(ctx, draftUpdate(noKey))))
}

func TestPrepareStorageMigrationDraftRequiresS3Storage(t *testing.T) {
	ctx := context.Background()
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("storage migration tests run against sqlite")
	}
	s, _ := newAttachmentTestService(ctx, t)

	// A default instance stores attachments in the database. There is nothing in S3 to move, so
	// the answer is "configure S3 first", not a migration.
	err := s.prepareStorageMigrationSettingForUpdate(ctx, draftUpdate(targetConfig("https://s3.example.com", "kb", "assets")))
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestPrepareStorageMigrationDraftKeepsServerOwnedFields(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)

	target := targetConfig("https://s3.example.com", "kb-new", "assets")
	passed := &storepb.InstanceStorageMigrationSetting{
		State:          storepb.InstanceStorageMigrationSetting_PRECHECKED,
		TargetS3Config: target,
		CreateTime:     timestamppb.Now(),
		Precheck:       &storepb.InstanceStorageMigrationSetting_PrecheckResult{Passed: true, ProbeKey: "assets/.probe"},
	}
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: passed},
	})
	require.NoError(t, err)

	// Resaving the same target (with the write-only secret blanked, as a client would) keeps the
	// precheck and the stored secret: nothing about the target changed.
	unchanged := targetConfig("https://s3.example.com", "kb-new", "assets")
	unchanged.AccessKeySecret = ""
	update := draftUpdate(unchanged)
	// A client trying to promote itself past the precheck must have no effect.
	update.GetStorageMigrationSetting().State = storepb.InstanceStorageMigrationSetting_READY
	require.NoError(t, s.prepareStorageMigrationSettingForUpdate(ctx, update))
	kept := update.GetStorageMigrationSetting()
	require.Equal(t, storepb.InstanceStorageMigrationSetting_PRECHECKED, kept.State)
	require.True(t, kept.Precheck.GetPassed())
	require.Equal(t, "secret", kept.TargetS3Config.AccessKeySecret)

	// Changing the target invalidates the precheck: it was a statement about the old target.
	moved := draftUpdate(targetConfig("https://s3.example.com", "kb-other", "assets"))
	require.NoError(t, s.prepareStorageMigrationSettingForUpdate(ctx, moved))
	require.Equal(t, storepb.InstanceStorageMigrationSetting_DRAFT, moved.GetStorageMigrationSetting().State)
	require.Nil(t, moved.GetStorageMigrationSetting().Precheck)
}

func TestPrepareStorageMigrationDraftAbandon(t *testing.T) {
	ctx := context.Background()
	s, _ := newMigrationTestService(ctx, t)

	update := &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{
			StorageMigrationSetting: &storepb.InstanceStorageMigrationSetting{},
		},
	}
	require.NoError(t, s.prepareStorageMigrationSettingForUpdate(ctx, update))
	require.Equal(t, storepb.InstanceStorageMigrationSetting_STATE_UNSPECIFIED, update.GetStorageMigrationSetting().State)
	require.Nil(t, update.GetStorageMigrationSetting().TargetS3Config)
}

func TestStorageMigrationSettingRoundTripThroughAPI(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	admin := createTestUser(ctx, t, ts, "admin", store.RoleAdmin)
	adminCtx := context.WithValue(ctx, auth.UserIDContextKey, admin.ID)
	name := "instance/settings/" + storepb.InstanceSettingKey_STORAGE_MIGRATION.String()

	// No migration in flight is the normal state, not a 404.
	got, err := s.GetInstanceSetting(adminCtx, &v1pb.GetInstanceSettingRequest{Name: name})
	require.NoError(t, err)
	require.Equal(t, v1pb.InstanceSetting_StorageMigrationSetting_STATE_UNSPECIFIED, got.GetStorageMigrationSetting().State)

	_, err = s.UpdateInstanceSetting(adminCtx, &v1pb.UpdateInstanceSettingRequest{
		Setting: &v1pb.InstanceSetting{
			Name: name,
			Value: &v1pb.InstanceSetting_StorageMigrationSetting_{
				StorageMigrationSetting: &v1pb.InstanceSetting_StorageMigrationSetting{
					TargetS3Config: &v1pb.InstanceSetting_StorageSetting_S3Config{
						Endpoint:        "https://s3.example.com",
						Bucket:          "kb-new",
						RootPrefix:      "assets",
						Region:          "us-east-1",
						AccessKeyId:     "key",
						AccessKeySecret: "secret",
					},
				},
			},
		},
	})
	require.NoError(t, err)

	got, err = s.GetInstanceSetting(adminCtx, &v1pb.GetInstanceSettingRequest{Name: name})
	require.NoError(t, err)
	migration := got.GetStorageMigrationSetting()
	require.Equal(t, v1pb.InstanceSetting_StorageMigrationSetting_DRAFT, migration.State)
	require.Equal(t, "kb-new", migration.TargetS3Config.Bucket)
	// The target credentials are write-only, exactly like the live S3 config's.
	require.Empty(t, migration.TargetS3Config.AccessKeySecret)
	// ...but they are still stored, or the precheck would have nothing to authenticate with.
	stored, err := ts.GetInstanceStorageMigrationSetting(ctx)
	require.NoError(t, err)
	require.Equal(t, "secret", stored.TargetS3Config.AccessKeySecret)
}

func TestStorageMigrationSettingIsAdminOnly(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	member := createTestUser(ctx, t, ts, "member", store.RoleUser)
	memberCtx := context.WithValue(ctx, auth.UserIDContextKey, member.ID)

	// The setting carries the target bucket's credentials, so it is admin-only like the live
	// storage setting.
	_, err := s.GetInstanceSetting(memberCtx, &v1pb.GetInstanceSettingRequest{
		Name: "instance/settings/" + storepb.InstanceSettingKey_STORAGE_MIGRATION.String(),
	})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = s.PrecheckStorageMigration(memberCtx, &v1pb.PrecheckStorageMigrationRequest{})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

func TestPrecheckRequiresADraftedTarget(t *testing.T) {
	ctx := context.Background()
	s, ts := newMigrationTestService(ctx, t)
	admin := createTestUser(ctx, t, ts, "admin", store.RoleAdmin)
	adminCtx := context.WithValue(ctx, auth.UserIDContextKey, admin.ID)

	_, err := s.PrecheckStorageMigration(adminCtx, &v1pb.PrecheckStorageMigrationRequest{})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}
