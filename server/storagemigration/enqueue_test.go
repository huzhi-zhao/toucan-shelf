package storagemigration

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/storage/attachmentpath"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// The work list is where the historical flat layout gets folded in and where orphaned
// attachments get their directory decided, so the target keys it computes are the whole
// contract of the copy phase.

func newTestStore(ctx context.Context, t *testing.T) *store.Store {
	t.Helper()
	if driver := os.Getenv("DRIVER"); driver != "" && driver != "sqlite" {
		t.Skip("storage migration tests run against sqlite")
	}
	return teststore.NewTestingStore(ctx, t)
}

func createS3Attachment(ctx context.Context, t *testing.T, ts *store.Store, uid string, creatorID int32, memoID *int32, key string) *store.Attachment {
	t.Helper()
	create := &store.Attachment{
		UID:         uid,
		CreatorID:   creatorID,
		MemoID:      memoID,
		Filename:    "a.png",
		Type:        "image/png",
		Size:        3,
		StorageType: storepb.AttachmentStorageType_S3,
		Reference:   key,
	}
	if key != "" {
		create.Payload = &storepb.AttachmentPayload{
			Payload: &storepb.AttachmentPayload_S3Object_{
				S3Object: &storepb.AttachmentPayload_S3Object{Key: key},
			},
		}
	}
	attachment, err := ts.CreateAttachment(ctx, create)
	require.NoError(t, err)
	return attachment
}

func TestEnqueueRecomputesTargetKeys(t *testing.T) {
	ctx := context.Background()
	ts := newTestStore(ctx, t)
	user, err := ts.CreateUser(ctx, &store.User{
		Username: "owner", Role: store.RoleAdmin, Email: "owner@example.com", Nickname: "owner", PasswordHash: "hash",
	})
	require.NoError(t, err)
	workspace, err := ts.CreateWorkspace(ctx, &store.Workspace{UID: "kb1", CreatorID: user.ID, Title: "AI Notes"})
	require.NoError(t, err)
	slug, err := ts.EnsureWorkspaceStorageSlug(ctx, workspace)
	require.NoError(t, err)
	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: "memo1", CreatorID: user.ID, Content: "x", Visibility: store.Private, WorkspaceID: workspace.ID,
	})
	require.NoError(t, err)

	nested := createS3Attachment(ctx, t, ts, "nested", user.ID, &memo.ID, "assets/"+slug+"/17_uuid_a.png")
	// Written before the per-workspace directory existed: flat at the bucket root. Relocating
	// these is the historical clean-up that rides along with the migration.
	flat := createS3Attachment(ctx, t, ts, "flat", user.ID, &memo.ID, "assets/17_uuid_b.png")
	orphan := createS3Attachment(ctx, t, ts, "orphan", user.ID, nil, "assets/17_uuid_c.png")
	keyless := createS3Attachment(ctx, t, ts, "keyless", user.ID, &memo.ID, "")

	total, err := Enqueue(ctx, ts, &storepb.StorageS3Config{Bucket: "kb-new", RootPrefix: "shelf"})
	require.NoError(t, err)
	require.Equal(t, 4, total)

	jobs, err := ts.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{})
	require.NoError(t, err)
	byID := map[int32]*store.AttachmentMigrationJob{}
	for _, job := range jobs {
		byID[job.AttachmentID] = job
	}

	// The directory is recomputed and the file name segment is kept, so the same attachment
	// always computes the same target and a resumed run is idempotent.
	require.Equal(t, "shelf/"+slug+"/17_uuid_a.png", byID[nested.ID].TargetKey)
	require.Equal(t, "shelf/"+slug+"/17_uuid_b.png", byID[flat.ID].TargetKey)
	require.Equal(t, "shelf/"+attachmentpath.UnassignedWorkspaceSlug+"/17_uuid_c.png", byID[orphan.ID].TargetKey)
	require.Equal(t, store.AttachmentMigrationStatusPending, byID[nested.ID].Status)

	// An S3 row with no object key has nothing to copy; it is recorded rather than dropped.
	require.Equal(t, store.AttachmentMigrationStatusSkipped, byID[keyless.ID].Status)
	require.NotEmpty(t, byID[keyless.ID].LastError)
}

func TestEnqueueUsesBucketRootWhenPrefixIsEmpty(t *testing.T) {
	ctx := context.Background()
	ts := newTestStore(ctx, t)
	user, err := ts.CreateUser(ctx, &store.User{
		Username: "owner", Role: store.RoleAdmin, Email: "owner@example.com", Nickname: "owner", PasswordHash: "hash",
	})
	require.NoError(t, err)
	attachment := createS3Attachment(ctx, t, ts, "orphan", user.ID, nil, "assets/17_uuid_a.png")

	_, err = Enqueue(ctx, ts, &storepb.StorageS3Config{Bucket: "kb-new"})
	require.NoError(t, err)

	jobs, err := ts.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{AttachmentID: &attachment.ID})
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, attachmentpath.UnassignedWorkspaceSlug+"/17_uuid_a.png", jobs[0].TargetKey)
}
