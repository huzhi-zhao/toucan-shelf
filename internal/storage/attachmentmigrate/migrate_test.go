package attachmentmigrate_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"github.com/lithammer/shortuuid/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/storage/attachmentmigrate"
	"github.com/usememos/memos/internal/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	storetest "github.com/usememos/memos/store/test"
)

// fakeObjectStore records what the migration asked of S3 and lets a test seed objects that
// already exist at a key.
type fakeObjectStore struct {
	objects map[string]int64
	copies  []copyCall
	uploads []string
}

type copyCall struct {
	sourceBucket string
	sourceKey    string
	destKey      string
}

func (f *fakeObjectStore) HeadObject(_ context.Context, key string) (*s3.ObjectInfo, error) {
	size, ok := f.objects[key]
	if !ok {
		return nil, nil
	}
	return &s3.ObjectInfo{Size: size}, nil
}

func (f *fakeObjectStore) CopyObject(_ context.Context, sourceBucket, sourceKey, destKey string) error {
	f.copies = append(f.copies, copyCall{sourceBucket, sourceKey, destKey})
	f.objects[destKey] = f.objects[sourceKey]
	return nil
}

func (f *fakeObjectStore) GetObjectStream(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(make([]byte, f.objects[key]))), nil
}

func (f *fakeObjectStore) UploadObject(_ context.Context, key string, _ string, content io.Reader) (string, error) {
	blob, err := io.ReadAll(content)
	if err != nil {
		return "", err
	}
	f.uploads = append(f.uploads, key)
	f.objects[key] = int64(len(blob))
	return key, nil
}

// fakeS3 hands out one fakeObjectStore per endpoint+bucket, so a test can watch a cross-bucket
// or cross-endpoint migration.
type fakeS3 struct {
	stores map[string]*fakeObjectStore
}

func newFakeS3() *fakeS3 {
	return &fakeS3{stores: map[string]*fakeObjectStore{}}
}

func (f *fakeS3) store(endpoint, bucket string) *fakeObjectStore {
	key := endpoint + "|" + bucket
	if f.stores[key] == nil {
		f.stores[key] = &fakeObjectStore{objects: map[string]int64{}}
	}
	return f.stores[key]
}

func (f *fakeS3) factory() attachmentmigrate.ClientFactory {
	return func(_ context.Context, config *storepb.StorageS3Config) (attachmentmigrate.ObjectStore, error) {
		return f.store(config.Endpoint, config.Bucket), nil
	}
}

const (
	testEndpoint = "https://s3.example.com"
	testBucket   = "toucan"
)

func s3Config(endpoint, bucket string) *storepb.StorageS3Config {
	return &storepb.StorageS3Config{
		AccessKeyId:     "key",
		AccessKeySecret: "secret",
		Endpoint:        endpoint,
		Region:          "us-east-1",
		Bucket:          bucket,
	}
}

func setStorageSetting(ctx context.Context, t *testing.T, ts *store.Store, template string, config *storepb.StorageS3Config) {
	t.Helper()
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{
				StorageType:      storepb.InstanceStorageSetting_S3,
				FilepathTemplate: template,
				S3Config:         config,
			},
		},
	})
	require.NoError(t, err)
}

func createUser(ctx context.Context, t *testing.T, ts *store.Store) *store.User {
	t.Helper()
	user, err := ts.CreateUser(ctx, &store.User{
		Username:     "migrate-" + shortuuid.New(),
		Role:         store.RoleAdmin,
		Email:        shortuuid.New() + "@test.com",
		Nickname:     "migrate",
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	return user
}

func createWorkspace(ctx context.Context, t *testing.T, ts *store.Store, user *store.User, title, slug string) *store.Workspace {
	t.Helper()
	workspace, err := ts.CreateWorkspace(ctx, &store.Workspace{
		UID: shortuuid.New(), CreatorID: user.ID, Title: title, StorageSlug: slug,
	})
	require.NoError(t, err)
	return workspace
}

func createMemo(ctx context.Context, t *testing.T, ts *store.Store, user *store.User, workspaceID int32) *store.Memo {
	t.Helper()
	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID: shortuuid.New(), CreatorID: user.ID, Content: "content", Visibility: store.Private, WorkspaceID: workspaceID,
	})
	require.NoError(t, err)
	return memo
}

func createS3Attachment(ctx context.Context, t *testing.T, ts *store.Store, user *store.User, memoID *int32, filename, key string, size int64, config *storepb.StorageS3Config) *store.Attachment {
	t.Helper()
	attachment, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID:         shortuuid.New(),
		CreatorID:   user.ID,
		Filename:    filename,
		Type:        "image/png",
		Size:        size,
		StorageType: storepb.AttachmentStorageType_S3,
		Reference:   key,
		MemoID:      memoID,
		Payload: &storepb.AttachmentPayload{
			Payload: &storepb.AttachmentPayload_S3Object_{
				S3Object: &storepb.AttachmentPayload_S3Object{S3Config: config, Key: key},
			},
		},
	})
	require.NoError(t, err)
	return attachment
}

// backdate rewrites created_ts, which the database fills in itself on insert. The migration
// expands time placeholders against it, so a test that wants to prove it isn't using "now"
// has to move it into the past.
func backdate(ctx context.Context, t *testing.T, ts *store.Store, attachmentID int32, createdTs int64) {
	t.Helper()
	_, err := ts.GetDriver().GetDB().ExecContext(ctx, "UPDATE `attachment` SET `created_ts` = ? WHERE `id` = ?", createdTs, attachmentID)
	require.NoError(t, err)
}

func TestPlanClassifiesAttachments(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)

	// Uploaded before per-workspace directories existed.
	legacy := createS3Attachment(ctx, t, ts, user, &memo.ID, "old.png", "assets/old.png", 10, config)
	// Already where the template says it belongs.
	settled := createS3Attachment(ctx, t, ts, user, &memo.ID, "new.png", "assets/notes/new.png", 20, config)
	// Never attached to a document.
	orphan := createS3Attachment(ctx, t, ts, user, nil, "loose.png", "assets/loose.png", 30, config)
	// Marked S3 but carrying no key at all.
	broken, err := ts.CreateAttachment(ctx, &store.Attachment{
		UID: shortuuid.New(), CreatorID: user.ID, Filename: "broken.png", Type: "image/png",
		StorageType: storepb.AttachmentStorageType_S3,
	})
	require.NoError(t, err)

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	plan, err := migrator.Plan(ctx, false)
	require.NoError(t, err)

	byID := map[int32]*attachmentmigrate.Item{}
	for _, item := range plan.Items {
		byID[item.AttachmentID] = item
	}
	require.Len(t, plan.Items, 4)

	require.Equal(t, attachmentmigrate.StatusPending, byID[legacy.ID].Status)
	require.Equal(t, "assets/notes/old.png", byID[legacy.ID].TargetKey)
	require.Equal(t, attachmentmigrate.StatusInPlace, byID[settled.ID].Status)
	require.Equal(t, attachmentmigrate.StatusPending, byID[orphan.ID].Status)
	require.Equal(t, "assets/_unassigned/loose.png", byID[orphan.ID].TargetKey)
	require.Equal(t, attachmentmigrate.StatusSkipped, byID[broken.ID].Status)
	require.NotEmpty(t, byID[broken.ID].Reason)

	inPlace, pending, skipped := plan.Counts()
	require.Equal(t, 1, inPlace)
	require.Equal(t, 2, pending)
	require.Equal(t, 1, skipped)
}

func TestPlanRefusesUnstableDirectoryTemplate(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	setStorageSetting(ctx, t, ts, "assets/{uuid}/{filename}", s3Config(testEndpoint, testBucket))

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	_, err := migrator.Plan(ctx, false)
	require.Error(t, err)
	require.Contains(t, err.Error(), "{uuid}")
}

func TestPlanRefusesNonS3Instance(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	_, err := ts.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{StorageType: storepb.InstanceStorageSetting_LOCAL},
		},
	})
	require.NoError(t, err)

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	_, err = migrator.Plan(ctx, false)
	require.Error(t, err)
}

// The target key must not drift between runs: time placeholders expand against the attachment's
// own creation time, and the basename is carried over unchanged.
func TestPlanTargetKeyIsStable(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{year}/{month}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	attachment := createS3Attachment(ctx, t, ts, user, &memo.ID, "a.png", "assets/2020/01/a.png", 10, config)
	backdate(ctx, t, ts, attachment.ID, 1600000000) // 2020-09-13 UTC

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	first, err := migrator.Plan(ctx, false)
	require.NoError(t, err)
	second, err := migrator.Plan(ctx, false)
	require.NoError(t, err)
	require.Equal(t, "assets/notes/2020/09/a.png", first.Items[0].TargetKey)
	require.Equal(t, first.Items[0].TargetKey, second.Items[0].TargetKey)
}

func TestPlanPreviewsWorkspaceSlugBackfill(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	// A knowledge base that predates the storage slug column.
	workspace := createWorkspace(ctx, t, ts, user, "Notes", "")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	createS3Attachment(ctx, t, ts, user, &memo.ID, "a.png", "assets/a.png", 10, config)

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	plan, err := migrator.Plan(ctx, false)
	require.NoError(t, err)
	require.True(t, plan.Items[0].SlugBackfilled)
	require.Equal(t, "assets/Notes/a.png", plan.Items[0].TargetKey)

	// A dry run must not have written the slug.
	reloaded, err := ts.GetWorkspace(ctx, &store.FindWorkspace{ID: &workspace.ID})
	require.NoError(t, err)
	require.Empty(t, reloaded.StorageSlug)

	// Planning for a real run persists it, so uploads made after the migration land in the
	// same directory the migration used.
	_, err = migrator.Plan(ctx, true)
	require.NoError(t, err)
	reloaded, err = ts.GetWorkspace(ctx, &store.FindWorkspace{ID: &workspace.ID})
	require.NoError(t, err)
	require.Equal(t, "Notes", reloaded.StorageSlug)
}

func TestApplyCopiesAndRepoints(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	attachment := createS3Attachment(ctx, t, ts, user, &memo.ID, "old.png", "assets/old.png", 10, config)

	fake := newFakeS3()
	fake.store(testEndpoint, testBucket).objects["assets/old.png"] = 10
	migrator := attachmentmigrate.NewWithClientFactory(ts, fake.factory())

	plan, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	require.NoError(t, migrator.Apply(ctx, plan))
	require.Equal(t, attachmentmigrate.OutcomeCopied, plan.Items[0].Outcome)
	require.Equal(t, []copyCall{{testBucket, "assets/old.png", "assets/notes/old.png"}}, fake.store(testEndpoint, testBucket).copies)

	// The source object is deliberately left behind.
	require.Contains(t, fake.store(testEndpoint, testBucket).objects, "assets/old.png")

	reloaded, err := ts.GetAttachment(ctx, &store.FindAttachment{ID: &attachment.ID})
	require.NoError(t, err)
	require.Equal(t, "assets/notes/old.png", reloaded.Reference)
	require.Equal(t, "assets/notes/old.png", reloaded.Payload.GetS3Object().Key)
	require.Equal(t, testBucket, reloaded.Payload.GetS3Object().S3Config.Bucket)

	// Re-running finds nothing left to do.
	second, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	_, pending, _ := second.Counts()
	require.Equal(t, 0, pending)
}

func TestApplyIsIdempotentWhenObjectAlreadyCopied(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	createS3Attachment(ctx, t, ts, user, &memo.ID, "old.png", "assets/old.png", 10, config)

	fake := newFakeS3()
	bucket := fake.store(testEndpoint, testBucket)
	bucket.objects["assets/old.png"] = 10
	// An earlier run copied the object but died before repointing the row.
	bucket.objects["assets/notes/old.png"] = 10

	migrator := attachmentmigrate.NewWithClientFactory(ts, fake.factory())
	plan, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	require.NoError(t, migrator.Apply(ctx, plan))

	require.Equal(t, attachmentmigrate.OutcomeReused, plan.Items[0].Outcome)
	require.Empty(t, bucket.copies)
}

func TestApplyRefusesToOverwriteADifferentObject(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	attachment := createS3Attachment(ctx, t, ts, user, &memo.ID, "old.png", "assets/old.png", 10, config)

	fake := newFakeS3()
	bucket := fake.store(testEndpoint, testBucket)
	bucket.objects["assets/old.png"] = 10
	bucket.objects["assets/notes/old.png"] = 999 // someone else's file

	migrator := attachmentmigrate.NewWithClientFactory(ts, fake.factory())
	plan, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	require.NoError(t, migrator.Apply(ctx, plan))

	require.Equal(t, attachmentmigrate.OutcomeFailed, plan.Items[0].Outcome)
	require.Contains(t, plan.Items[0].Error, "already holds a different object")
	require.EqualValues(t, 999, bucket.objects["assets/notes/old.png"])

	// The row was left pointing at the object that is actually still there.
	reloaded, err := ts.GetAttachment(ctx, &store.FindAttachment{ID: &attachment.ID})
	require.NoError(t, err)
	require.Equal(t, "assets/old.png", reloaded.Payload.GetS3Object().Key)

	var out bytes.Buffer
	require.Equal(t, 1, plan.WriteApplyReport(&out))
	require.Contains(t, out.String(), "1 failed")
}

func TestApplyStreamsAcrossEndpoints(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	oldConfig := s3Config("https://old.example.com", "old-bucket")
	newConfig := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", newConfig)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	// The object still sits where it was uploaded, under the old endpoint's bucket.
	createS3Attachment(ctx, t, ts, user, &memo.ID, "old.png", "assets/notes/old.png", 10, oldConfig)

	fake := newFakeS3()
	fake.store("https://old.example.com", "old-bucket").objects["assets/notes/old.png"] = 10
	migrator := attachmentmigrate.NewWithClientFactory(ts, fake.factory())

	plan, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	require.Equal(t, attachmentmigrate.StatusPending, plan.Items[0].Status)
	require.NoError(t, migrator.Apply(ctx, plan))

	require.Equal(t, attachmentmigrate.OutcomeCopied, plan.Items[0].Outcome)
	require.Equal(t, []string{"assets/notes/old.png"}, fake.store(testEndpoint, testBucket).uploads)
	require.Empty(t, fake.store(testEndpoint, testBucket).copies)
}

// A row pointing at an object that is not in the source bucket is a hole that predates the
// migration. It must be reported as its own thing: calling it a failure sends the operator
// looking for a bug in a run that did exactly what it should.
func TestApplyReportsAMissingSourceApartFromAFailure(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	broken := createS3Attachment(ctx, t, ts, user, &memo.ID, "gone.png", "assets/gone.png", 10, config)
	createS3Attachment(ctx, t, ts, user, &memo.ID, "here.png", "assets/here.png", 10, config)

	fake := newFakeS3()
	// Only one of the two objects is actually in the bucket.
	fake.store(testEndpoint, testBucket).objects["assets/here.png"] = 10
	migrator := attachmentmigrate.NewWithClientFactory(ts, fake.factory())

	plan, err := migrator.Plan(ctx, true)
	require.NoError(t, err)
	require.NoError(t, migrator.Apply(ctx, plan))

	outcomes := map[int32]attachmentmigrate.Outcome{}
	for _, item := range plan.Items {
		outcomes[item.AttachmentID] = item.Outcome
	}
	require.Equal(t, attachmentmigrate.OutcomeSourceMissing, outcomes[broken.ID])

	// The broken row must not stop the intact one behind it, and must not be repointed at an
	// object that was never copied.
	require.Equal(t, []string{"assets/here.png"}, copiedSourceKeys(fake.store(testEndpoint, testBucket).copies))
	reloaded, err := ts.GetAttachment(ctx, &store.FindAttachment{ID: &broken.ID})
	require.NoError(t, err)
	require.Equal(t, "assets/gone.png", reloaded.Payload.GetS3Object().Key)

	var report bytes.Buffer
	failed := plan.WriteApplyReport(&report)
	require.Equal(t, 0, failed, "a pre-existing broken link is not a failure of this run")
	require.Contains(t, report.String(), "1 source object missing")
	require.Contains(t, report.String(), "assets/gone.png")
}

func copiedSourceKeys(calls []copyCall) []string {
	keys := make([]string, 0, len(calls))
	for _, call := range calls {
		keys = append(keys, call.sourceKey)
	}
	return keys
}

func TestWritePlanReportGroupsByWorkspace(t *testing.T) {
	ctx := context.Background()
	ts := storetest.NewTestingStore(ctx, t)
	config := s3Config(testEndpoint, testBucket)
	setStorageSetting(ctx, t, ts, "assets/{workspace}/{filename}", config)

	user := createUser(ctx, t, ts)
	workspace := createWorkspace(ctx, t, ts, user, "笔记", "notes")
	memo := createMemo(ctx, t, ts, user, workspace.ID)
	createS3Attachment(ctx, t, ts, user, &memo.ID, "a.png", "assets/a.png", 10, config)
	createS3Attachment(ctx, t, ts, user, nil, "b.png", "assets/b.png", 10, config)

	migrator := attachmentmigrate.NewWithClientFactory(ts, newFakeS3().factory())
	plan, err := migrator.Plan(ctx, false)
	require.NoError(t, err)

	var out bytes.Buffer
	plan.WritePlanReport(&out)
	report := out.String()
	require.Contains(t, report, "2 total")
	require.Contains(t, report, "notes: 1")
	require.Contains(t, report, "_unassigned")
	require.True(t, strings.Contains(report, "-> assets/notes/a.png"))
}
