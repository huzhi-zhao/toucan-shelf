// Package storagemigration moves every S3 attachment object to a new storage location without
// changing a single attachment's public URI.
//
// The shape of the flow is: copy everything to the target while the instance still reads from the
// source, verify it all arrived, then flip the instance configuration and every attachment's
// object key in one transaction. Nothing in the source is ever deleted -- the operator does that
// by hand once they have checked the result. See
// docs/dev/design/20260902-attachment-storage-migration.md.
package storagemigration

import (
	"bytes"
	"context"
	"path"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/storage/attachmentpath"
	"github.com/usememos/memos/internal/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// copyBatchSize is how many objects one worker pass copies. It bounds how long a single pass
// holds on before the state is written back, which is what makes a killed process resume from
// roughly where it stopped rather than from the beginning.
const copyBatchSize = 20

// Enqueue adds a work-list row for every S3 attachment that does not have one yet, and returns
// how many it added.
//
// It only ever adds. Re-running it is how stragglers are picked up -- an upload that slipped
// through in the moment between closing the write gate and scanning the attachment table would
// otherwise keep its old-location key and break at the switch -- and rewriting the rows that are
// already there would throw away the progress it is meant to protect.
//
// The target key is recomputed rather than derived by swapping a prefix. That is what folds the
// historical flat layout in for free -- attachments written before the per-workspace directory
// existed sit at the bucket root and simply get a different directory this time round -- and it
// is what makes a resumed run idempotent: the same attachment always computes the same target,
// so a row that was already copied is recognisable by looking at the target rather than by
// trusting a status column.
func Enqueue(ctx context.Context, st *store.Store, target *storepb.StorageS3Config) (int, error) {
	storageType := storepb.AttachmentStorageType_S3
	all, err := st.ListAttachments(ctx, &store.FindAttachment{StorageType: &storageType})
	if err != nil {
		return 0, errors.Wrap(err, "failed to list S3 attachments")
	}
	existing, err := st.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{})
	if err != nil {
		return 0, errors.Wrap(err, "failed to read the migration work list")
	}
	queued := map[int32]bool{}
	for _, job := range existing {
		queued[job.AttachmentID] = true
	}
	attachments := make([]*store.Attachment, 0, len(all))
	for _, attachment := range all {
		if !queued[attachment.ID] {
			attachments = append(attachments, attachment)
		}
	}
	if len(attachments) == 0 {
		return 0, nil
	}

	slugs, err := workspaceSlugsForAttachments(ctx, st, attachments)
	if err != nil {
		return 0, err
	}

	rootPrefix := strings.Trim(target.GetRootPrefix(), "/")
	jobs := make([]*store.AttachmentMigrationJob, 0, len(attachments))
	for _, attachment := range attachments {
		sourceKey := attachment.Payload.GetS3Object().GetKey()
		if sourceKey == "" {
			// An S3 row with no object key has nothing to copy and nothing to point at. It is
			// already broken; record it so it shows up in the result instead of vanishing.
			jobs = append(jobs, &store.AttachmentMigrationJob{
				AttachmentID: attachment.ID,
				Status:       store.AttachmentMigrationStatusSkipped,
				LastError:    "the attachment has no S3 object key",
			})
			continue
		}
		jobs = append(jobs, &store.AttachmentMigrationJob{
			AttachmentID: attachment.ID,
			SourceKey:    sourceKey,
			TargetKey:    path.Join(rootPrefix, slugs[attachment.ID], path.Base(sourceKey)),
			Status:       store.AttachmentMigrationStatusPending,
		})
	}
	if err := st.UpsertAttachmentMigrationJobs(ctx, jobs); err != nil {
		return 0, errors.Wrap(err, "failed to write the migration work list")
	}
	return len(jobs), nil
}

// workspaceSlugsForAttachments resolves every attachment's owning directory in two queries rather
// than two per attachment.
func workspaceSlugsForAttachments(ctx context.Context, st *store.Store, attachments []*store.Attachment) (map[int32]string, error) {
	memoIDs := []int32{}
	seenMemo := map[int32]bool{}
	for _, attachment := range attachments {
		if attachment.MemoID != nil && !seenMemo[*attachment.MemoID] {
			seenMemo[*attachment.MemoID] = true
			memoIDs = append(memoIDs, *attachment.MemoID)
		}
	}

	memoWorkspace := map[int32]int32{}
	if len(memoIDs) > 0 {
		memos, err := st.ListMemos(ctx, &store.FindMemo{IDList: memoIDs, ExcludeContent: true, ExcludeComments: false})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list the memos owning the attachments")
		}
		for _, memo := range memos {
			memoWorkspace[memo.ID] = memo.WorkspaceID
		}
	}

	workspaceSlug := map[int32]string{}
	workspaces, err := st.ListWorkspaces(ctx, &store.FindWorkspace{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list workspaces")
	}
	for _, workspace := range workspaces {
		// A workspace that never received an upload has no slug yet. Generating it now is the
		// same lazy backfill the upload path does, and it has to happen before the keys are
		// computed or the attachments would move to a directory that later changes name.
		slug, err := st.EnsureWorkspaceStorageSlug(ctx, workspace)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to resolve the storage slug of workspace %d", workspace.ID)
		}
		workspaceSlug[workspace.ID] = slug
	}

	slugs := map[int32]string{}
	for _, attachment := range attachments {
		slug := ""
		if attachment.MemoID != nil {
			slug = workspaceSlug[memoWorkspace[*attachment.MemoID]]
		}
		if slug == "" {
			// No document, a deleted document, or a document outside any workspace: the same
			// directory the upload path uses when it is handed no workspace.
			slug = attachmentpath.UnassignedWorkspaceSlug
		}
		slugs[attachment.ID] = slug
	}
	return slugs, nil
}

// clients holds the two ends of a migration plus whether S3 can copy between them itself.
type clients struct {
	source         *s3.Client
	target         *s3.Client
	sourceBucket   string
	serverSideCopy bool
}

func newClients(ctx context.Context, current, target *storepb.StorageS3Config) (*clients, error) {
	sourceClient, err := s3.NewClient(ctx, current)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create the source S3 client")
	}
	targetClient, err := s3.NewClient(ctx, target)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create the target S3 client")
	}
	return &clients{
		source:         sourceClient,
		target:         targetClient,
		sourceBucket:   current.GetBucket(),
		serverSideCopy: CanServerSideCopy(current, target),
	}, nil
}

// CanServerSideCopy reports whether S3 can copy objects between the two locations itself instead
// of streaming every byte through Toucan.
//
// The rule is "everything except where the data is must be identical". Comparing only the
// endpoint is not enough: the same endpoint with a different access key is very likely a
// different account or tenant, and a cross-account server-side copy needs bucket policy on both
// sides that cannot be assumed. Guessing wrong in the cautious direction only costs time;
// guessing wrong the other way fails object by object, halfway through.
func CanServerSideCopy(current, target *storepb.StorageS3Config) bool {
	if current == nil || target == nil {
		return false
	}
	stripped := func(cfg *storepb.StorageS3Config) *storepb.StorageS3Config {
		clone, _ := proto.Clone(cfg).(*storepb.StorageS3Config)
		clone.Bucket = ""
		clone.RootPrefix = ""
		return clone
	}
	return proto.Equal(stripped(current), stripped(target))
}

// CopyPending copies up to copyBatchSize outstanding objects and reports how many rows it
// advanced. Zero means the copy phase is finished.
func CopyPending(ctx context.Context, st *store.Store, current, target *storepb.StorageS3Config) (int, error) {
	pending := store.AttachmentMigrationStatusPending
	limit := copyBatchSize
	jobs, err := st.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{Status: &pending, Limit: &limit})
	if err != nil {
		return 0, errors.Wrap(err, "failed to read the migration work list")
	}
	if len(jobs) == 0 {
		return 0, nil
	}

	cs, err := newClients(ctx, current, target)
	if err != nil {
		return 0, err
	}
	for _, job := range jobs {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		update := copyOne(ctx, cs, job)
		if err := st.UpdateAttachmentMigrationJob(ctx, update); err != nil {
			return 0, errors.Wrapf(err, "failed to record the result for attachment %d", job.AttachmentID)
		}
	}
	return len(jobs), nil
}

func copyOne(ctx context.Context, cs *clients, job *store.AttachmentMigrationJob) *store.UpdateAttachmentMigrationJob {
	update := &store.UpdateAttachmentMigrationJob{AttachmentID: job.AttachmentID}
	attempts := job.Attempts + 1
	update.Attempts = &attempts
	fail := func(err error) *store.UpdateAttachmentMigrationJob {
		status := store.AttachmentMigrationStatusFailed
		message := err.Error()
		update.Status, update.LastError = &status, &message
		return update
	}

	source, err := cs.source.HeadObject(ctx, job.SourceKey)
	if err != nil {
		return fail(errors.Wrap(err, "cannot read the source object"))
	}
	if source == nil {
		// The database says there is an object and the bucket disagrees. This attachment was
		// already broken before the migration started, so it is recorded and stepped over
		// rather than allowed to stop everything behind it.
		status := store.AttachmentMigrationStatusSkipped
		message := "the source object does not exist; this attachment was already broken before the migration"
		update.Status, update.LastError = &status, &message
		return update
	}
	update.Size = &source.Size

	// A target object that is already there with the same size is this row's own work from a
	// previous run. Skipping it is what makes a resumed migration cheap, and it is also why
	// "change the endpoint but point at the same data" costs one stat per object and no copying.
	existing, err := cs.target.HeadObject(ctx, job.TargetKey)
	if err != nil {
		return fail(errors.Wrap(err, "cannot check the target object"))
	}
	if existing != nil && existing.Size == source.Size {
		status := store.AttachmentMigrationStatusDone
		empty := ""
		update.Status, update.LastError = &status, &empty
		return update
	}

	if cs.serverSideCopy {
		if err := cs.target.CopyObject(ctx, cs.sourceBucket, job.SourceKey, job.TargetKey); err != nil {
			return fail(errors.Wrap(err, "server-side copy failed"))
		}
	} else {
		// Read the whole object into memory before uploading. Streaming an unknown-length reader
		// makes some S3-compatible providers compute a body hash that does not match what they
		// received (the same SignatureDoesNotMatch the backup job hit), and attachments are
		// capped at the instance upload limit, so one object at a time is bounded.
		blob, err := cs.source.GetObject(ctx, job.SourceKey)
		if err != nil {
			return fail(errors.Wrap(err, "cannot download the source object"))
		}
		if _, err := cs.target.UploadObject(ctx, job.TargetKey, "application/octet-stream", bytes.NewReader(blob)); err != nil {
			return fail(errors.Wrap(err, "cannot upload to the target"))
		}
	}

	status := store.AttachmentMigrationStatusDone
	empty := ""
	update.Status, update.LastError = &status, &empty
	return update
}

// Reconcile verifies every copied object at the target and returns how many rows it demoted to
// failed. It re-stats objects the copy phase already reported as done on purpose: "the PUT
// returned 200" and "the object is there" are different claims, and only the second one is worth
// switching the instance over on.
func Reconcile(ctx context.Context, st *store.Store, target *storepb.StorageS3Config) (int, error) {
	done := store.AttachmentMigrationStatusDone
	jobs, err := st.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{Status: &done})
	if err != nil {
		return 0, errors.Wrap(err, "failed to read the migration work list")
	}
	client, err := s3.NewClient(ctx, target)
	if err != nil {
		return 0, errors.Wrap(err, "failed to create the target S3 client")
	}

	failed := 0
	for _, job := range jobs {
		if ctx.Err() != nil {
			return failed, ctx.Err()
		}
		stat, err := client.HeadObject(ctx, job.TargetKey)
		reason := ""
		switch {
		case err != nil:
			reason = "cannot verify the target object: " + err.Error()
		case stat == nil:
			reason = "the object is missing at the target"
		case stat.Size != job.Size:
			reason = "the object at the target has a different size than the source"
		}
		if reason == "" {
			continue
		}
		status := store.AttachmentMigrationStatusFailed
		if err := st.UpdateAttachmentMigrationJob(ctx, &store.UpdateAttachmentMigrationJob{
			AttachmentID: job.AttachmentID,
			Status:       &status,
			LastError:    &reason,
		}); err != nil {
			return failed, errors.Wrapf(err, "failed to record the reconciliation result for attachment %d", job.AttachmentID)
		}
		failed++
	}
	return failed, nil
}

// Apply is the switch: every attachment's object key moves to its new location, the instance's
// storage configuration becomes the target, the migration setting is cleared and the work list is
// dropped -- in one transaction.
//
// Rows that were skipped are rewritten too. Their object does not exist at either end, so the
// attachment stays broken either way; expressing every key in the new layout keeps "where the
// attachments are" answerable with one location triple, which is the whole point of the exercise.
func Apply(ctx context.Context, st *store.Store, target *storepb.StorageS3Config) error {
	jobs, err := st.ListAttachmentMigrationJobs(ctx, &store.FindAttachmentMigrationJob{})
	if err != nil {
		return errors.Wrap(err, "failed to read the migration work list")
	}
	storageSetting, err := st.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to read the storage setting")
	}

	rewrites := make([]*store.AttachmentStorageRewrite, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == store.AttachmentMigrationStatusFailed || job.TargetKey == "" {
			continue
		}
		id := job.AttachmentID
		attachment, err := st.GetAttachment(ctx, &store.FindAttachment{ID: &id})
		if err != nil {
			return errors.Wrapf(err, "failed to read attachment %d", id)
		}
		if attachment == nil {
			// Deleting attachments is frozen during a migration, so this only happens if the
			// gate was bypassed. Skipping is right either way: there is no row to point.
			continue
		}
		payload, _ := proto.Clone(attachment.Payload).(*storepb.AttachmentPayload)
		if payload == nil {
			payload = &storepb.AttachmentPayload{}
		}
		payload.Payload = &storepb.AttachmentPayload_S3Object_{
			S3Object: &storepb.AttachmentPayload_S3Object{
				// The snapshot is what reads fall back to if the instance ever stops being an
				// S3 instance, so it has to describe the new location too.
				S3Config: target,
				Key:      job.TargetKey,
			},
		}
		rewrites = append(rewrites, &store.AttachmentStorageRewrite{
			AttachmentID: id,
			Reference:    job.TargetKey,
			Payload:      payload,
		})
	}

	newStorageSetting, _ := proto.Clone(storageSetting).(*storepb.InstanceStorageSetting)
	newStorageSetting.S3Config = target
	return st.ApplyAttachmentStorageMigration(ctx, rewrites, newStorageSetting)
}
