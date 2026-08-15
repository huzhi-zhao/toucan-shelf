package store

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/base"
	"github.com/usememos/memos/internal/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
)

type Attachment struct {
	// ID is the system generated unique identifier for the attachment.
	ID int32
	// UID is the user defined unique identifier for the attachment.
	UID string

	// Standard fields
	CreatorID int32
	CreatedTs int64
	UpdatedTs int64

	// Domain specific fields
	Filename    string
	Blob        []byte
	Type        string
	Size        int64
	StorageType storepb.AttachmentStorageType
	Reference   string
	Payload     *storepb.AttachmentPayload

	// The related memo ID.
	MemoID *int32

	// Composed field
	MemoUID *string
}

type FindAttachment struct {
	GetBlob        bool
	ID             *int32
	UID            *string
	CreatorID      *int32
	Filename       *string
	FilenameSearch *string
	MemoID         *int32
	MemoIDList     []int32
	HasRelatedMemo bool
	StorageType    *storepb.AttachmentStorageType
	Filters        []string
	Limit          *int
	Offset         *int
}

type UpdateAttachment struct {
	ID        int32
	UID       *string
	UpdatedTs *int64
	Filename  *string
	MemoID    *int32
	Reference *string
	Payload   *storepb.AttachmentPayload
	// Blob and Size overwrite the attachment's content in place. Only set for
	// database-backed attachments (LOCAL/S3 blobs live outside the row and are
	// rewritten by the caller); Size is set for every storage type so the row
	// keeps matching the bytes actually stored.
	Blob []byte
	Size *int64
	// UnsetMemoID, when true, clears memo_id (sets it to NULL), unlinking the
	// attachment from its memo without deleting the file. Used when restoring a
	// memo version so attachments dropped by the restore are kept, not destroyed.
	// Ignored if MemoID is also set.
	UnsetMemoID bool
}

type DeleteAttachment struct {
	ID     int32
	MemoID *int32
}

const (
	thumbnailCacheFolder = ".thumbnail_cache"
	motionCacheFolder    = ".motion_cache"
)

type deleteAttachmentStorageFailpointKey struct{}

// ErrDeleteAttachmentStorageFailpoint is returned by the test-only attachment storage failpoint.
var ErrDeleteAttachmentStorageFailpoint = errors.New("delete attachment storage failpoint")

// WithDeleteAttachmentStorageFailpoint forces DeleteAttachmentStorage to return a failpoint error.
func WithDeleteAttachmentStorageFailpoint(ctx context.Context) context.Context {
	return context.WithValue(ctx, deleteAttachmentStorageFailpointKey{}, true)
}

func (s *Store) CreateAttachment(ctx context.Context, create *Attachment) (*Attachment, error) {
	if !base.UIDMatcher.MatchString(create.UID) {
		return nil, errors.New("invalid uid")
	}
	return s.driver.CreateAttachment(ctx, create)
}

func (s *Store) ListAttachments(ctx context.Context, find *FindAttachment) ([]*Attachment, error) {
	// Set default limits to prevent loading too many attachments at once
	shouldApplyDefaultLimit := find.Limit == nil && len(find.MemoIDList) == 0
	if shouldApplyDefaultLimit && find.GetBlob {
		// When fetching blobs, we should be especially careful with limits
		defaultLimit := 10
		find.Limit = &defaultLimit
	} else if shouldApplyDefaultLimit {
		// Even without blobs, let's default to a reasonable limit
		defaultLimit := 100
		find.Limit = &defaultLimit
	}

	return s.driver.ListAttachments(ctx, find)
}

func (s *Store) GetAttachment(ctx context.Context, find *FindAttachment) (*Attachment, error) {
	attachments, err := s.ListAttachments(ctx, find)
	if err != nil {
		return nil, err
	}

	if len(attachments) == 0 {
		return nil, nil
	}

	return attachments[0], nil
}

func (s *Store) UpdateAttachment(ctx context.Context, update *UpdateAttachment) error {
	if update.UID != nil && !base.UIDMatcher.MatchString(*update.UID) {
		return errors.New("invalid uid")
	}
	return s.driver.UpdateAttachment(ctx, update)
}

func (s *Store) DeleteAttachment(ctx context.Context, delete *DeleteAttachment) error {
	attachment, err := s.GetAttachment(ctx, &FindAttachment{ID: &delete.ID})
	if err != nil {
		return errors.Wrap(err, "failed to get attachment")
	}
	if attachment == nil {
		return errors.New("attachment not found")
	}

	if err := s.DeleteAttachmentStorage(ctx, attachment); err != nil {
		if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
			return errors.Wrap(err, "failed to delete local file")
		}
		slog.Warn("Failed to delete attachment storage", slog.Any("err", err))
	}

	return s.driver.DeleteAttachment(ctx, delete)
}

func (s *Store) DeleteAttachments(ctx context.Context, attachments []*Attachment) error {
	if len(attachments) == 0 {
		return nil
	}

	deletes := make([]*DeleteAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment == nil {
			continue
		}
		deletes = append(deletes, &DeleteAttachment{ID: attachment.ID, MemoID: attachment.MemoID})
	}
	if len(deletes) == 0 {
		return nil
	}

	if err := s.driver.DeleteAttachments(ctx, deletes); err != nil {
		return err
	}

	instanceStorageSetting, instanceStorageSettingErr := s.getAttachmentStorageCleanupInstanceSetting(ctx, attachments)
	for _, attachment := range attachments {
		if attachment == nil {
			continue
		}
		var err error
		if instanceStorageSettingErr != nil && AttachmentNeedsInstanceStorageSetting(attachment) {
			err = instanceStorageSettingErr
		} else {
			err = s.deleteAttachmentStorageImpl(ctx, attachment, instanceStorageSetting)
		}
		if err != nil {
			if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
				return errors.Wrap(err, "failed to delete local file")
			}
			slog.Warn("Failed to delete attachment storage", slog.Any("err", err))
		}
	}

	return nil
}

func (s *Store) DeleteAttachmentStorage(ctx context.Context, attachment *Attachment) error {
	return s.deleteAttachmentStorageImpl(ctx, attachment, nil)
}

// ResolveAttachmentS3Config returns the S3 config to use when reading or deleting an attachment
// object. Each attachment snapshots the S3 config that was active at upload time, so changing the
// endpoint or credentials later (e.g. moving MinIO to a new domain) would leave existing
// attachments pointing at a backend that no longer answers. The instance storage setting is the
// source of truth for where the S3 backend currently lives, so prefer it and only fall back to the
// stored snapshot when the instance is no longer configured for S3.
func (s *Store) ResolveAttachmentS3Config(ctx context.Context, stored *storepb.StorageS3Config) (*storepb.StorageS3Config, error) {
	instanceStorageSetting, err := s.GetInstanceStorageSetting(ctx)
	if err != nil {
		if stored != nil {
			slog.Warn("Failed to get instance storage setting, falling back to stored S3 config", slog.Any("err", err))
			return stored, nil
		}
		return nil, errors.Wrap(err, "failed to get instance storage setting")
	}
	if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_S3 && instanceStorageSetting.S3Config != nil {
		return instanceStorageSetting.S3Config, nil
	}
	if stored != nil {
		return stored, nil
	}
	return nil, errors.New("S3 config is not found")
}

// DeleteAttachmentStorageWithInstanceSetting deletes attachment storage using a preloaded instance storage setting.
func (s *Store) DeleteAttachmentStorageWithInstanceSetting(ctx context.Context, attachment *Attachment, instanceStorageSetting *storepb.InstanceStorageSetting) error {
	return s.deleteAttachmentStorageImpl(ctx, attachment, instanceStorageSetting)
}

func (s *Store) deleteAttachmentStorageImpl(ctx context.Context, attachment *Attachment, instanceStorageSetting *storepb.InstanceStorageSetting) error {
	if attachment == nil {
		return nil
	}
	if shouldFailDeleteAttachmentStorage(ctx) {
		return ErrDeleteAttachmentStorageFailpoint
	}

	if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
		if err := func() error {
			p := filepath.FromSlash(attachment.Reference)
			if !filepath.IsAbs(p) {
				p = filepath.Join(s.profile.Data, p)
			}
			err := os.Remove(p)
			if err != nil && !os.IsNotExist(err) {
				return errors.Wrap(err, "failed to delete local file")
			}
			return nil
		}(); err != nil {
			return err
		}
	} else if attachment.StorageType == storepb.AttachmentStorageType_S3 {
		if err := func() error {
			s3ObjectPayload := attachment.Payload.GetS3Object()
			if s3ObjectPayload == nil {
				return errors.Errorf("No s3 object found")
			}
			// Prefer the instance's current S3 config over the snapshot taken at upload time, so
			// objects stay reachable after the endpoint or credentials change.
			s3Config := s3ObjectPayload.S3Config
			if instanceStorageSetting != nil {
				if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_S3 && instanceStorageSetting.S3Config != nil {
					s3Config = instanceStorageSetting.S3Config
				}
			} else {
				resolved, err := s.ResolveAttachmentS3Config(ctx, s3Config)
				if err != nil {
					return err
				}
				s3Config = resolved
			}
			if s3Config == nil {
				return errors.Errorf("S3 config is not found")
			}

			s3Client, err := s3.NewClient(ctx, s3Config)
			if err != nil {
				return errors.Wrap(err, "Failed to create s3 client")
			}
			if err := s3Client.DeleteObject(ctx, s3ObjectPayload.Key); err != nil {
				return errors.Wrap(err, "Failed to delete s3 object")
			}
			return nil
		}(); err != nil {
			return err
		}
	}

	s.deleteAttachmentDerivedCaches(attachment)
	return nil
}

func (s *Store) getAttachmentStorageCleanupInstanceSetting(ctx context.Context, attachments []*Attachment) (*storepb.InstanceStorageSetting, error) {
	for _, attachment := range attachments {
		if AttachmentNeedsInstanceStorageSetting(attachment) {
			instanceStorageSetting, err := s.GetInstanceStorageSetting(ctx)
			if err != nil {
				return nil, errors.Wrap(err, "failed to get instance storage setting")
			}
			return instanceStorageSetting, nil
		}
	}
	return nil, nil
}

// AttachmentNeedsInstanceStorageSetting reports whether S3 cleanup needs the instance fallback storage setting.
func AttachmentNeedsInstanceStorageSetting(attachment *Attachment) bool {
	if attachment == nil || attachment.StorageType != storepb.AttachmentStorageType_S3 {
		return false
	}
	s3ObjectPayload := attachment.Payload.GetS3Object()
	return s3ObjectPayload != nil && s3ObjectPayload.S3Config == nil
}

func (s *Store) deleteAttachmentDerivedCaches(attachment *Attachment) {
	for _, cachePath := range []string{
		filepath.Join(s.profile.Data, thumbnailCacheFolder, attachment.UID+".jpeg"),
		filepath.Join(s.profile.Data, motionCacheFolder, attachment.UID+".mp4"),
	} {
		if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
			slog.Warn("Failed to delete derived attachment cache", slog.String("path", cachePath), slog.Any("err", err))
		}
	}
}

func shouldFailDeleteAttachmentStorage(ctx context.Context) bool {
	failpoint, ok := ctx.Value(deleteAttachmentStorageFailpointKey{}).(bool)
	return ok && failpoint
}
