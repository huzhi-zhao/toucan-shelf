package store

import (
	"context"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	storepb "github.com/usememos/memos/proto/gen/store"
)

type InstanceSetting struct {
	Name        string
	Value       string
	Description string
}

type FindInstanceSetting struct {
	Name string
}

type DeleteInstanceSetting struct {
	Name string
}

func (s *Store) UpsertInstanceSetting(ctx context.Context, upsert *storepb.InstanceSetting) (*storepb.InstanceSetting, error) {
	instanceSettingRaw := &InstanceSetting{
		Name: upsert.Key.String(),
	}
	valueString, err := marshalInstanceSettingValue(upsert)
	if err != nil {
		return nil, err
	}
	instanceSettingRaw.Value = valueString
	instanceSettingRaw, err = s.driver.UpsertInstanceSetting(ctx, instanceSettingRaw)
	if err != nil {
		return nil, errors.Wrap(err, "Failed to upsert instance setting")
	}
	instanceSetting, err := convertInstanceSettingFromRaw(instanceSettingRaw)
	if err != nil {
		return nil, errors.Wrap(err, "Failed to convert instance setting")
	}
	s.instanceSettingCache.Set(ctx, instanceSetting.Key.String(), instanceSetting)
	return instanceSetting, nil
}

// marshalInstanceSettingValue renders one setting's oneof payload as the JSON blob stored in the
// value column. It is separate from UpsertInstanceSetting because the attachment storage
// migration writes settings inside its own transaction, and both paths have to agree byte for
// byte on the encoding.
func marshalInstanceSettingValue(setting *storepb.InstanceSetting) (string, error) {
	var valueBytes []byte
	var err error
	switch setting.Key {
	case storepb.InstanceSettingKey_BASIC:
		valueBytes, err = protojson.Marshal(setting.GetBasicSetting())
	case storepb.InstanceSettingKey_GENERAL:
		valueBytes, err = protojson.Marshal(setting.GetGeneralSetting())
	case storepb.InstanceSettingKey_STORAGE:
		valueBytes, err = protojson.Marshal(setting.GetStorageSetting())
	case storepb.InstanceSettingKey_MEMO_RELATED:
		valueBytes, err = protojson.Marshal(setting.GetMemoRelatedSetting())
	case storepb.InstanceSettingKey_TAGS:
		valueBytes, err = protojson.Marshal(setting.GetTagsSetting())
	case storepb.InstanceSettingKey_NOTIFICATION:
		valueBytes, err = protojson.Marshal(setting.GetNotificationSetting())
	case storepb.InstanceSettingKey_AI:
		valueBytes, err = protojson.Marshal(setting.GetAiSetting())
	case storepb.InstanceSettingKey_BACKUP:
		valueBytes, err = protojson.Marshal(setting.GetBackupSetting())
	case storepb.InstanceSettingKey_STORAGE_MIGRATION:
		valueBytes, err = protojson.Marshal(setting.GetStorageMigrationSetting())
	default:
		return "", errors.Errorf("unsupported instance setting key: %v", setting.Key)
	}
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal instance setting value")
	}
	return string(valueBytes), nil
}

func (s *Store) ListInstanceSettings(ctx context.Context, find *FindInstanceSetting) ([]*storepb.InstanceSetting, error) {
	list, err := s.driver.ListInstanceSettings(ctx, find)
	if err != nil {
		return nil, err
	}

	instanceSettings := []*storepb.InstanceSetting{}
	for _, instanceSettingRaw := range list {
		instanceSetting, err := convertInstanceSettingFromRaw(instanceSettingRaw)
		if err != nil {
			return nil, errors.Wrap(err, "Failed to convert instance setting")
		}
		if instanceSetting == nil {
			continue
		}
		s.instanceSettingCache.Set(ctx, instanceSetting.Key.String(), instanceSetting)
		instanceSettings = append(instanceSettings, instanceSetting)
	}
	return instanceSettings, nil
}

func (s *Store) GetInstanceSetting(ctx context.Context, find *FindInstanceSetting) (*storepb.InstanceSetting, error) {
	if cache, ok := s.instanceSettingCache.Get(ctx, find.Name); ok {
		instanceSetting, ok := cache.(*storepb.InstanceSetting)
		if ok {
			return instanceSetting, nil
		}
	}

	list, err := s.ListInstanceSettings(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	if len(list) > 1 {
		return nil, errors.Errorf("found multiple instance settings with key %s", find.Name)
	}
	return list[0], nil
}

func (s *Store) GetInstanceBasicSetting(ctx context.Context) (*storepb.InstanceBasicSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_BASIC.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance basic setting")
	}

	instanceBasicSetting := &storepb.InstanceBasicSetting{}
	if instanceSetting != nil {
		instanceBasicSetting = instanceSetting.GetBasicSetting()
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_BASIC.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_BASIC,
		Value: &storepb.InstanceSetting_BasicSetting{BasicSetting: instanceBasicSetting},
	})
	return instanceBasicSetting, nil
}

func (s *Store) GetInstanceGeneralSetting(ctx context.Context) (*storepb.InstanceGeneralSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_GENERAL.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance general setting")
	}

	instanceGeneralSetting := &storepb.InstanceGeneralSetting{}
	if instanceSetting != nil {
		instanceGeneralSetting = instanceSetting.GetGeneralSetting()
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_GENERAL.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_GENERAL,
		Value: &storepb.InstanceSetting_GeneralSetting{GeneralSetting: instanceGeneralSetting},
	})
	return instanceGeneralSetting, nil
}

// DefaultContentLengthLimit is the default limit of content length in bytes. 1MB.
//
// Upstream's 24KB suited a quick-notes app; this instance is used as a knowledge
// base, where a single document can be a full report. The limit counts bytes, so
// 24KB allowed only ~8k CJK characters (3 bytes each) — reached halfway through
// an ordinary long-form document.
//
// 1MB is ~350k CJK characters. Nothing in the stack objects at that size: the
// transport cap is 256MB (maxAPIRequestBytes), SQLite and Postgres TEXT hold up
// to 1GB, MySQL's content columns are LONGTEXT as of 0.30/08, and markdown is
// only parsed per save. The practical ceiling is client-side rendering of a
// single document, which stays comfortable well past any realistic prose length.
const DefaultContentLengthLimit = 1024 * 1024

// HTMLContentLengthLimit is the content length limit applied to HTML documents, in bytes.
// HTML docs (e.g. pasted/uploaded AI-generated pages) are self-contained and routinely
// exceed the plain-markdown limit, so they get a much larger cap. 10MB.
const HTMLContentLengthLimit = 10 * 1024 * 1024

// DefaultReactions is the default reactions for memo related setting.
var DefaultReactions = []string{"👍", "👎", "❤️", "🎉", "😄", "😕", "😢", "😡"}

func (s *Store) GetInstanceMemoRelatedSetting(ctx context.Context) (*storepb.InstanceMemoRelatedSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_MEMO_RELATED.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance general setting")
	}

	instanceMemoRelatedSetting := &storepb.InstanceMemoRelatedSetting{}
	if instanceSetting != nil {
		instanceMemoRelatedSetting = instanceSetting.GetMemoRelatedSetting()
	}
	if instanceMemoRelatedSetting.ContentLengthLimit < DefaultContentLengthLimit {
		instanceMemoRelatedSetting.ContentLengthLimit = DefaultContentLengthLimit
	}
	if len(instanceMemoRelatedSetting.Reactions) == 0 {
		instanceMemoRelatedSetting.Reactions = append(instanceMemoRelatedSetting.Reactions, DefaultReactions...)
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_MEMO_RELATED.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_MEMO_RELATED,
		Value: &storepb.InstanceSetting_MemoRelatedSetting{MemoRelatedSetting: instanceMemoRelatedSetting},
	})
	return instanceMemoRelatedSetting, nil
}

func (s *Store) GetInstanceTagsSetting(ctx context.Context) (*storepb.InstanceTagsSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_TAGS.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance tags setting")
	}

	instanceTagsSetting := &storepb.InstanceTagsSetting{}
	if instanceSetting != nil {
		instanceTagsSetting = instanceSetting.GetTagsSetting()
	}
	if instanceTagsSetting.Tags == nil {
		instanceTagsSetting.Tags = map[string]*storepb.InstanceTagMetadata{}
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_TAGS.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_TAGS,
		Value: &storepb.InstanceSetting_TagsSetting{TagsSetting: instanceTagsSetting},
	})
	return instanceTagsSetting, nil
}

func (s *Store) GetInstanceNotificationSetting(ctx context.Context) (*storepb.InstanceNotificationSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_NOTIFICATION.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance notification setting")
	}

	instanceNotificationSetting := &storepb.InstanceNotificationSetting{}
	if instanceSetting != nil {
		instanceNotificationSetting = instanceSetting.GetNotificationSetting()
	}
	if instanceNotificationSetting.Email == nil {
		instanceNotificationSetting.Email = &storepb.InstanceNotificationSetting_EmailSetting{}
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_NOTIFICATION.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_NOTIFICATION,
		Value: &storepb.InstanceSetting_NotificationSetting{NotificationSetting: instanceNotificationSetting},
	})
	return instanceNotificationSetting, nil
}

// GetInstanceAISetting gets the AI provider settings for the instance.
func (s *Store) GetInstanceAISetting(ctx context.Context) (*storepb.InstanceAISetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_AI.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance AI setting")
	}

	instanceAISetting := &storepb.InstanceAISetting{}
	if instanceSetting != nil {
		instanceAISetting = instanceSetting.GetAiSetting()
	}
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_AI.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: instanceAISetting},
	})
	return instanceAISetting, nil
}

const (
	defaultInstanceStorageType       = storepb.InstanceStorageSetting_LOCAL
	defaultInstanceUploadSizeLimitMb = 100
	// LEGACY-COMPAT(storage/three-level-path): filepath_template is still the source of truth
	// for LOCAL storage, where {workspace} expands to nothing and the historical flat layout is
	// left untouched. For S3 the path is now the three-level model below, and this template only
	// survives as the thing an old instance is decomposed from.
	defaultInstanceFilepathTemplate = "assets/{workspace}/{timestamp}_{uuid}_{filename}"

	// The S3 object path is root_prefix / workspace storage slug / filename_template. Only the
	// two ends are configurable: the middle directory is decided by the system so that "where
	// the data lives" stays a single comparable pair (bucket, root_prefix). See
	// docs/dev/requirements/storage/attachment-storage-migration.md.
	defaultInstanceRootPrefix       = "assets"
	defaultInstanceFilenameTemplate = "{timestamp}_{uuid}_{filename}"

	// workspacePlaceholder is where an old filepath_template splits into root prefix and file name.
	workspacePlaceholder = "{workspace}"
)

func (s *Store) GetInstanceStorageSetting(ctx context.Context) (*storepb.InstanceStorageSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_STORAGE.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance storage setting")
	}

	instanceStorageSetting := &storepb.InstanceStorageSetting{}
	if instanceSetting != nil {
		instanceStorageSetting = instanceSetting.GetStorageSetting()
	}
	if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_STORAGE_TYPE_UNSPECIFIED {
		instanceStorageSetting.StorageType = defaultInstanceStorageType
	}
	if instanceStorageSetting.UploadSizeLimitMb == 0 {
		instanceStorageSetting.UploadSizeLimitMb = defaultInstanceUploadSizeLimitMb
	}
	if instanceStorageSetting.FilepathTemplate == "" {
		instanceStorageSetting.FilepathTemplate = defaultInstanceFilepathTemplate
	}
	decomposeStorageFilepathTemplate(instanceStorageSetting)
	s.instanceSettingCache.Set(ctx, storepb.InstanceSettingKey_STORAGE.String(), &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: instanceStorageSetting},
	})
	return instanceStorageSetting, nil
}

// decomposeStorageFilepathTemplate fills in the three-level S3 path model for a setting written
// before that model existed, by splitting the old free-form filepath_template around
// {workspace}. It is the same lazy-backfill shape as EnsureWorkspaceStorageSlug: the instance
// setting is one JSON blob, so there is nothing a SQL migration could rewrite. The result is
// materialized on the next settings write.
//
// filename_template being empty is the marker for "not decomposed yet". root_prefix cannot serve
// as the marker because an empty root prefix legitimately means the bucket root, whereas a file
// name template is never legitimately empty.
func decomposeStorageFilepathTemplate(setting *storepb.InstanceStorageSetting) {
	if setting.FilenameTemplate != "" {
		return
	}
	rootPrefix, filenameTemplate := splitFilepathTemplate(setting.FilepathTemplate)
	setting.FilenameTemplate = filenameTemplate
	// root_prefix lives on the S3 config; with no S3 config there is nothing to carry it, and
	// whoever configures S3 later states the prefix themselves.
	if setting.S3Config != nil && setting.S3Config.RootPrefix == "" {
		setting.S3Config.RootPrefix = rootPrefix
	}
}

// splitFilepathTemplate splits an old filepath_template into (root prefix, file name template).
//
// Everything before {workspace} becomes the root prefix and everything after it becomes the file
// name. A template that never mentions {workspace} is split at its last separator instead, which
// is the flat historical layout: its whole directory part is the root prefix.
//
// Directory segments the admin wrote *after* {workspace} end up inside the file name template,
// producing a "file name" containing a slash. That is accepted: it only affects how an old
// config is displayed, and the first migration recomputes those keys anyway.
func splitFilepathTemplate(template string) (rootPrefix, filenameTemplate string) {
	template = strings.Trim(strings.TrimSpace(template), "/")
	if template == "" {
		return defaultInstanceRootPrefix, defaultInstanceFilenameTemplate
	}
	if idx := strings.Index(template, workspacePlaceholder); idx >= 0 {
		rootPrefix = strings.Trim(template[:idx], "/")
		filenameTemplate = strings.Trim(template[idx+len(workspacePlaceholder):], "/")
	} else if idx := strings.LastIndex(template, "/"); idx >= 0 {
		rootPrefix = template[:idx]
		filenameTemplate = template[idx+1:]
	} else {
		filenameTemplate = template
	}
	if filenameTemplate == "" {
		filenameTemplate = defaultInstanceFilenameTemplate
	}
	return rootPrefix, filenameTemplate
}

// DefaultInstanceBackupPathTemplate is the default S3 object key template for database backups.
const DefaultInstanceBackupPathTemplate = "backups/{timestamp}_{uuid}.db.gz"

// GetInstanceBackupSetting gets the database backup config/status for the instance.
func (s *Store) GetInstanceBackupSetting(ctx context.Context) (*storepb.InstanceBackupSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_BACKUP.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance backup setting")
	}

	instanceBackupSetting := &storepb.InstanceBackupSetting{}
	if instanceSetting != nil {
		instanceBackupSetting = instanceSetting.GetBackupSetting()
	}
	if instanceBackupSetting.PathTemplate == "" {
		instanceBackupSetting.PathTemplate = DefaultInstanceBackupPathTemplate
	}
	return instanceBackupSetting, nil
}

// GetInstanceStorageMigrationSetting returns the in-flight attachment storage migration, or a
// zero-valued setting (state STATE_UNSPECIFIED) when no migration exists. Callers must treat the
// zero value as "no migration": it is by far the common case, so returning nil would put a nil
// check in front of every read.
func (s *Store) GetInstanceStorageMigrationSetting(ctx context.Context) (*storepb.InstanceStorageMigrationSetting, error) {
	instanceSetting, err := s.GetInstanceSetting(ctx, &FindInstanceSetting{
		Name: storepb.InstanceSettingKey_STORAGE_MIGRATION.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get instance storage migration setting")
	}
	if instanceSetting == nil || instanceSetting.GetStorageMigrationSetting() == nil {
		return &storepb.InstanceStorageMigrationSetting{}, nil
	}
	// A copy, not the cached object: every caller of this advances the state machine by mutating
	// what it gets back and then saving. Handing out the cached pointer would mean a save that
	// fails still leaves the cache claiming the new state, and the write gate reads that cache.
	migration, ok := proto.Clone(instanceSetting.GetStorageMigrationSetting()).(*storepb.InstanceStorageMigrationSetting)
	if !ok {
		return &storepb.InstanceStorageMigrationSetting{}, nil
	}
	return migration, nil
}

func convertInstanceSettingFromRaw(instanceSettingRaw *InstanceSetting) (*storepb.InstanceSetting, error) {
	instanceSetting := &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey(storepb.InstanceSettingKey_value[instanceSettingRaw.Name]),
	}
	switch instanceSettingRaw.Name {
	case storepb.InstanceSettingKey_BASIC.String():
		basicSetting := &storepb.InstanceBasicSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), basicSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_BasicSetting{BasicSetting: basicSetting}
	case storepb.InstanceSettingKey_GENERAL.String():
		generalSetting := &storepb.InstanceGeneralSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), generalSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_GeneralSetting{GeneralSetting: generalSetting}
	case storepb.InstanceSettingKey_STORAGE.String():
		storageSetting := &storepb.InstanceStorageSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), storageSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_StorageSetting{StorageSetting: storageSetting}
	case storepb.InstanceSettingKey_MEMO_RELATED.String():
		memoRelatedSetting := &storepb.InstanceMemoRelatedSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), memoRelatedSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_MemoRelatedSetting{MemoRelatedSetting: memoRelatedSetting}
	case storepb.InstanceSettingKey_TAGS.String():
		tagsSetting := &storepb.InstanceTagsSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), tagsSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_TagsSetting{TagsSetting: tagsSetting}
	case storepb.InstanceSettingKey_NOTIFICATION.String():
		notificationSetting := &storepb.InstanceNotificationSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), notificationSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_NotificationSetting{NotificationSetting: notificationSetting}
	case storepb.InstanceSettingKey_AI.String():
		aiSetting := &storepb.InstanceAISetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), aiSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_AiSetting{AiSetting: aiSetting}
	case storepb.InstanceSettingKey_BACKUP.String():
		backupSetting := &storepb.InstanceBackupSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), backupSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_BackupSetting{BackupSetting: backupSetting}
	case storepb.InstanceSettingKey_STORAGE_MIGRATION.String():
		storageMigrationSetting := &storepb.InstanceStorageMigrationSetting{}
		if err := protojsonUnmarshaler.Unmarshal([]byte(instanceSettingRaw.Value), storageMigrationSetting); err != nil {
			return nil, err
		}
		instanceSetting.Value = &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: storageMigrationSetting}
	default:
		// Skip unsupported instance setting key.
		return nil, nil
	}
	return instanceSetting, nil
}
