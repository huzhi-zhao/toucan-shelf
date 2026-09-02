// Package attachmentmigrate moves existing S3 attachment objects to the keys the instance's
// current filepath template would produce, and repoints the database at the new keys.
//
// It exists for two reasons (see docs/dev/requirements/storage/20260826-attachment-object-migration.md):
// changing the bucket or root prefix, and filing attachments uploaded before per-knowledge-base
// directories existed under their knowledge base's directory.
//
// The migration copies and repoints; it never moves. The source object is left alone, which is
// what makes every run reversible by restoring the database alone, and what makes a re-run safe.
package attachmentmigrate

import (
	"bytes"
	"context"
	"io"
	"path"
	"sort"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/storage/attachmentpath"
	"github.com/usememos/memos/internal/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// ObjectStore is the slice of the S3 client the migration uses. It is an interface so the
// migration can be tested without an S3 endpoint; *s3.Client satisfies it.
type ObjectStore interface {
	HeadObject(ctx context.Context, key string) (*s3.ObjectInfo, error)
	CopyObject(ctx context.Context, sourceBucket, sourceKey, destKey string) error
	GetObjectStream(ctx context.Context, key string) (io.ReadCloser, error)
	UploadObject(ctx context.Context, key string, fileType string, content io.Reader) (string, error)
}

// ClientFactory builds an ObjectStore for an S3 config.
type ClientFactory func(ctx context.Context, config *storepb.StorageS3Config) (ObjectStore, error)

func defaultClientFactory(ctx context.Context, config *storepb.StorageS3Config) (ObjectStore, error) {
	return s3.NewClient(ctx, config)
}

// Status is what the plan concluded about one attachment.
type Status string

const (
	// StatusInPlace means the object already lives at the target key in the target bucket.
	StatusInPlace Status = "IN_PLACE"
	// StatusPending means the object has to be copied and the row repointed.
	StatusPending Status = "PENDING"
	// StatusSkipped means the attachment cannot be processed; Reason says why.
	StatusSkipped Status = "SKIPPED"
)

// Outcome is what applying the plan actually did to one pending item.
type Outcome string

const (
	// OutcomeCopied means the object was copied and the row repointed.
	OutcomeCopied Outcome = "COPIED"
	// OutcomeReused means an object of the right size was already at the target key — an
	// earlier run got that far — so only the row was repointed.
	OutcomeReused Outcome = "REUSED"
	// OutcomeFailed means the item was left untouched; Error says why.
	OutcomeFailed Outcome = "FAILED"
	// OutcomeSourceMissing means the row points at an object that is not in the source bucket.
	// The attachment was already broken before the migration -- it is reported separately from
	// FAILED because the two need different reactions: a failure is something to retry or
	// investigate, a missing source is a pre-existing hole the migration cannot fill and did
	// not create.
	OutcomeSourceMissing Outcome = "SOURCE_MISSING"
)

// Item is one attachment's place in the plan.
type Item struct {
	AttachmentID  int32
	AttachmentUID string
	Filename      string
	Size          int64
	ContentType   string

	// WorkspaceSlug is the knowledge base directory the attachment belongs under, or
	// attachmentpath.UnassignedWorkspaceSlug when it has no workspace.
	WorkspaceSlug string
	// SlugBackfilled records that the owning workspace had no storage slug yet, so one was
	// generated for it. In a dry run the slug is only previewed, not persisted.
	SlugBackfilled bool

	SourceBucket   string
	SourceEndpoint string
	SourceKey      string
	TargetKey      string

	Status Status
	Reason string

	Outcome Outcome
	Error   string
}

// Plan is the full reconciliation between what the database points at and what the current
// template says the keys should be. Building it changes nothing.
type Plan struct {
	Template       string
	TargetBucket   string
	TargetEndpoint string
	Items          []*Item
}

// Counts returns how many items fall into each status.
func (p *Plan) Counts() (inPlace, pending, skipped int) {
	for _, item := range p.Items {
		switch item.Status {
		case StatusInPlace:
			inPlace++
		case StatusPending:
			pending++
		case StatusSkipped:
			skipped++
		}
	}
	return inPlace, pending, skipped
}

// Migrator plans and applies attachment object migrations.
type Migrator struct {
	store     *store.Store
	newClient ClientFactory
}

// New returns a Migrator talking to the real S3 endpoints.
func New(s *store.Store) *Migrator {
	return &Migrator{store: s, newClient: defaultClientFactory}
}

// NewWithClientFactory returns a Migrator that builds object stores through factory. For tests.
func NewWithClientFactory(s *store.Store, factory ClientFactory) *Migrator {
	return &Migrator{store: s, newClient: factory}
}

// listLimit is high enough to hold every attachment of an instance this migration targets in
// one query. ListAttachments applies a small default limit otherwise, and paging while the
// apply pass is rewriting rows would be worse than loading the (blob-free) list at once.
const listLimit = 1000000

// Plan reconciles every S3 attachment against the current filepath template. It is read-only
// except for the workspace storage slug backfill, which only happens when persistSlugs is set.
func (m *Migrator) Plan(ctx context.Context, persistSlugs bool) (*Plan, error) {
	storageSetting, err := m.store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance storage setting")
	}
	if storageSetting.StorageType != storepb.InstanceStorageSetting_S3 || storageSetting.S3Config == nil {
		return nil, errors.New("instance is not configured for S3 storage; nothing to migrate")
	}
	template := attachmentpath.Normalize(storageSetting.FilepathTemplate)
	// A directory that expands differently on every run has no stable target key, so the
	// migration could neither tell "already done" from "not started" nor be re-run safely.
	// Refuse the whole run rather than migrate part of it (design §2).
	if placeholder := attachmentpath.UnstableDirPlaceholder(template); placeholder != "" {
		return nil, errors.Errorf(
			"filepath template %q uses %s in its directory part, which makes the target key non-deterministic; move it into the last segment before migrating",
			storageSetting.FilepathTemplate, placeholder)
	}
	dirTemplate := attachmentpath.Dir(template)
	targetConfig := storageSetting.S3Config

	storageType := storepb.AttachmentStorageType_S3
	limit := listLimit
	attachments, err := m.store.ListAttachments(ctx, &store.FindAttachment{
		StorageType: &storageType,
		Limit:       &limit,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list attachments")
	}
	sort.Slice(attachments, func(i, j int) bool { return attachments[i].ID < attachments[j].ID })

	slugs, err := m.resolveWorkspaceSlugs(ctx, attachments, persistSlugs)
	if err != nil {
		return nil, err
	}

	plan := &Plan{
		Template:       template,
		TargetBucket:   targetConfig.Bucket,
		TargetEndpoint: targetConfig.Endpoint,
		Items:          make([]*Item, 0, len(attachments)),
	}
	for _, attachment := range attachments {
		plan.Items = append(plan.Items, m.planItem(attachment, dirTemplate, targetConfig, slugs))
	}
	return plan, nil
}

func (m *Migrator) planItem(attachment *store.Attachment, dirTemplate string, targetConfig *storepb.StorageS3Config, slugs map[int32]workspaceSlug) *Item {
	item := &Item{
		AttachmentID:  attachment.ID,
		AttachmentUID: attachment.UID,
		Filename:      attachment.Filename,
		Size:          attachment.Size,
		ContentType:   attachment.Type,
	}
	s3Object := attachment.Payload.GetS3Object()
	if s3Object == nil || s3Object.Key == "" {
		item.Status = StatusSkipped
		item.Reason = "row is marked S3 but its payload carries no object key"
		return item
	}
	item.SourceKey = s3Object.Key
	// The snapshot taken at upload time says where the object actually is. Without one the
	// only thing we can assume is that it is where the instance currently points.
	sourceConfig := s3Object.S3Config
	if sourceConfig == nil {
		sourceConfig = targetConfig
	}
	item.SourceBucket = sourceConfig.Bucket
	item.SourceEndpoint = sourceConfig.Endpoint

	var slug workspaceSlug
	if attachment.MemoID != nil {
		slug = slugs[*attachment.MemoID]
	}
	item.WorkspaceSlug = slug.value
	if item.WorkspaceSlug == "" {
		item.WorkspaceSlug = attachmentpath.UnassignedWorkspaceSlug
	}
	item.SlugBackfilled = slug.backfilled

	// Time placeholders expand against the attachment's own creation time, not now, so the
	// target key is a pure function of the row and re-running produces the same answer.
	dir := attachmentpath.Expand(dirTemplate, attachmentpath.Context{
		WorkspaceSlug: item.WorkspaceSlug,
		At:            time.Unix(attachment.CreatedTs, 0),
	})
	// The basename is kept as-is rather than re-expanded from the template: it is what the
	// object is already called, and rewriting it would make the migration non-idempotent for
	// any template whose last segment contains {uuid} or {timestamp}.
	item.TargetKey = path.Join(dir, path.Base(s3Object.Key))

	if item.TargetKey == item.SourceKey &&
		item.SourceBucket == targetConfig.Bucket &&
		item.SourceEndpoint == targetConfig.Endpoint {
		item.Status = StatusInPlace
		return item
	}
	item.Status = StatusPending
	return item
}

type workspaceSlug struct {
	value      string
	backfilled bool
}

// resolveWorkspaceSlugs maps each attachment's memo to its knowledge base's storage slug.
// Workspaces created before the column existed have none; the slug is generated here (and, when
// persistSlugs is set, written back) so their attachments file under the right directory instead
// of all landing in _unassigned.
func (m *Migrator) resolveWorkspaceSlugs(ctx context.Context, attachments []*store.Attachment, persistSlugs bool) (map[int32]workspaceSlug, error) {
	memoIDs := make([]int32, 0, len(attachments))
	seen := map[int32]bool{}
	for _, attachment := range attachments {
		if attachment.MemoID == nil || seen[*attachment.MemoID] {
			continue
		}
		seen[*attachment.MemoID] = true
		memoIDs = append(memoIDs, *attachment.MemoID)
	}
	if len(memoIDs) == 0 {
		return map[int32]workspaceSlug{}, nil
	}

	memos, err := m.store.ListMemos(ctx, &store.FindMemo{IDList: memoIDs, ExcludeContent: true})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memos")
	}
	workspaceIDs := make([]int32, 0, len(memos))
	seenWorkspace := map[int32]bool{}
	for _, memo := range memos {
		if memo.WorkspaceID == 0 || seenWorkspace[memo.WorkspaceID] {
			continue
		}
		seenWorkspace[memo.WorkspaceID] = true
		workspaceIDs = append(workspaceIDs, memo.WorkspaceID)
	}

	workspaceSlugs := map[int32]workspaceSlug{}
	if len(workspaceIDs) > 0 {
		workspaces, err := m.store.ListWorkspaces(ctx, &store.FindWorkspace{IDList: workspaceIDs})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list workspaces")
		}
		for _, workspace := range workspaces {
			if workspace.StorageSlug != "" {
				workspaceSlugs[workspace.ID] = workspaceSlug{value: workspace.StorageSlug}
				continue
			}
			if persistSlugs {
				slug, err := m.store.EnsureWorkspaceStorageSlug(ctx, workspace)
				if err != nil {
					return nil, errors.Wrapf(err, "failed to backfill storage slug of workspace %d", workspace.ID)
				}
				workspaceSlugs[workspace.ID] = workspaceSlug{value: slug, backfilled: true}
				continue
			}
			// Dry run: show what the backfill would produce without writing it.
			slug, err := m.store.GenerateStorageSlug(ctx, workspace.UID, workspace.Title)
			if err != nil {
				return nil, errors.Wrapf(err, "failed to derive storage slug of workspace %d", workspace.ID)
			}
			workspaceSlugs[workspace.ID] = workspaceSlug{value: slug, backfilled: true}
		}
	}

	slugs := map[int32]workspaceSlug{}
	for _, memo := range memos {
		slugs[memo.ID] = workspaceSlugs[memo.WorkspaceID]
	}
	return slugs, nil
}

// Apply copies the objects of every pending item and repoints the rows at the new keys. The
// source objects are left in place; cleaning them up is a separate, manual decision (requirement §3).
func (m *Migrator) Apply(ctx context.Context, plan *Plan) error {
	storageSetting, err := m.store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get instance storage setting")
	}
	if storageSetting.StorageType != storepb.InstanceStorageSetting_S3 || storageSetting.S3Config == nil {
		return errors.New("instance is not configured for S3 storage; nothing to migrate")
	}
	targetConfig := storageSetting.S3Config
	targetClient, err := m.newClient(ctx, targetConfig)
	if err != nil {
		return errors.Wrap(err, "failed to create target s3 client")
	}

	for _, item := range plan.Items {
		if item.Status != StatusPending {
			continue
		}
		outcome, err := m.applyItem(ctx, item, targetClient, targetConfig)
		if err != nil {
			item.Outcome = OutcomeFailed
			item.Error = err.Error()
			continue
		}
		item.Outcome = outcome
	}
	return nil
}

func (m *Migrator) applyItem(ctx context.Context, item *Item, targetClient ObjectStore, targetConfig *storepb.StorageS3Config) (Outcome, error) {
	outcome := OutcomeCopied
	existing, err := targetClient.HeadObject(ctx, item.TargetKey)
	if err != nil {
		return "", errors.Wrap(err, "failed to probe target key")
	}
	switch {
	case existing == nil:
		// Ask whether the source is even there before trying to copy it. Without this the
		// answer arrives as a copy error and reads as "the migration broke", when what actually
		// happened is that this row was already pointing at nothing.
		present, err := m.sourcePresent(ctx, item, targetConfig)
		if err != nil {
			return "", err
		}
		if !present {
			return OutcomeSourceMissing, nil
		}
		if err := m.copyObject(ctx, item, targetClient, targetConfig); err != nil {
			return "", err
		}
	case item.Size <= 0 || existing.Size == item.Size:
		// Same size means this is the object an earlier run put there, so the copy is done
		// and only the row is left to fix. A row with no recorded size can't be checked;
		// trusting the key is still better than overwriting whatever is there.
		outcome = OutcomeReused
	default:
		// Something else already owns this key. Never overwrite: that would destroy data
		// this migration has no business touching.
		return "", errors.Errorf("target key %q already holds a different object (%d bytes, expected %d)", item.TargetKey, existing.Size, item.Size)
	}

	if err := m.repoint(ctx, item, targetConfig); err != nil {
		return "", err
	}
	return outcome, nil
}

// sourceClient builds a client for wherever this item's object actually lives. The source
// differs from the target only in endpoint and bucket: the credentials are the instance's
// current ones, because they are the only ones it has.
func (m *Migrator) sourceClient(ctx context.Context, item *Item, targetConfig *storepb.StorageS3Config) (ObjectStore, error) {
	if item.SourceEndpoint == targetConfig.Endpoint && item.SourceBucket == targetConfig.Bucket {
		return m.newClient(ctx, targetConfig)
	}
	sourceConfig, ok := proto.Clone(targetConfig).(*storepb.StorageS3Config)
	if !ok {
		return nil, errors.New("failed to clone the target s3 config")
	}
	sourceConfig.Endpoint = item.SourceEndpoint
	sourceConfig.Bucket = item.SourceBucket
	return m.newClient(ctx, sourceConfig)
}

// sourcePresent reports whether the object the row points at is actually in the source bucket.
func (m *Migrator) sourcePresent(ctx context.Context, item *Item, targetConfig *storepb.StorageS3Config) (bool, error) {
	client, err := m.sourceClient(ctx, item, targetConfig)
	if err != nil {
		return false, errors.Wrap(err, "failed to create source s3 client")
	}
	info, err := client.HeadObject(ctx, item.SourceKey)
	if err != nil {
		return false, errors.Wrapf(err, "failed to probe source object %s", item.SourceKey)
	}
	return info != nil, nil
}

func (m *Migrator) copyObject(ctx context.Context, item *Item, targetClient ObjectStore, targetConfig *storepb.StorageS3Config) error {
	if item.SourceEndpoint == targetConfig.Endpoint {
		// Same endpoint: the provider can copy server-side, across buckets included, without
		// the bytes ever reaching us.
		if err := targetClient.CopyObject(ctx, item.SourceBucket, item.SourceKey, item.TargetKey); err != nil {
			return errors.Wrapf(err, "failed to copy %s/%s to %s", item.SourceBucket, item.SourceKey, item.TargetKey)
		}
		return nil
	}
	// Different endpoints have no server-side copy between them, so the bytes come through us.
	sourceClient, err := m.sourceClient(ctx, item, targetConfig)
	if err != nil {
		return errors.Wrap(err, "failed to create source s3 client")
	}
	reader, err := sourceClient.GetObjectStream(ctx, item.SourceKey)
	if err != nil {
		return errors.Wrapf(err, "failed to read source object %s", item.SourceKey)
	}
	defer reader.Close()
	// Buffer before uploading rather than handing the stream straight to the SDK. A reader of
	// unpredictable length has been observed to produce SignatureDoesNotMatch against some
	// S3-compatible providers, because the request body hash is computed differently than for a
	// fixed-size buffer -- see the same note on the backup upload (server/backup/backup.go).
	// Attachments are bounded by the instance upload limit and copied one at a time.
	blob, err := io.ReadAll(reader)
	if err != nil {
		return errors.Wrapf(err, "failed to read source object %s", item.SourceKey)
	}
	if _, err := targetClient.UploadObject(ctx, item.TargetKey, item.ContentType, bytes.NewReader(blob)); err != nil {
		return errors.Wrapf(err, "failed to upload %s", item.TargetKey)
	}
	return nil
}

// repoint rewrites where the row says its object lives. The key is stored twice — the
// `reference` column and the payload — and the payload's config snapshot is refreshed at the
// same time so it describes the bucket the object is actually in now.
func (m *Migrator) repoint(ctx context.Context, item *Item, targetConfig *storepb.StorageS3Config) error {
	attachment, err := m.store.GetAttachment(ctx, &store.FindAttachment{ID: &item.AttachmentID})
	if err != nil {
		return errors.Wrap(err, "failed to reload attachment")
	}
	if attachment == nil {
		return errors.Errorf("attachment %d disappeared during migration", item.AttachmentID)
	}
	payload := &storepb.AttachmentPayload{}
	if attachment.Payload != nil {
		payload = proto.Clone(attachment.Payload).(*storepb.AttachmentPayload)
	}
	payload.Payload = &storepb.AttachmentPayload_S3Object_{
		S3Object: &storepb.AttachmentPayload_S3Object{
			S3Config: targetConfig,
			Key:      item.TargetKey,
		},
	}
	if err := m.store.UpdateAttachment(ctx, &store.UpdateAttachment{
		ID:        item.AttachmentID,
		Reference: &item.TargetKey,
		Payload:   payload,
	}); err != nil {
		return errors.Wrap(err, "failed to repoint attachment")
	}
	return nil
}
