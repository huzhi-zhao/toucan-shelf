// Package backup implements the SQLite-to-S3 database backup feature.
//
// Scope: only the SQLite database file is backed up (not attachment blobs, and not
// MySQL/Postgres instances - those already have their own backup tooling). The backup
// destination is always the instance's configured S3-compatible storage; retention/cleanup
// of old backups is left to the bucket's own lifecycle rules, not implemented here.
package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/storage/s3"
	"github.com/usememos/memos/internal/util"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// Run performs one backup: snapshot the SQLite database with VACUUM INTO, gzip it, and upload
// it to the instance's configured S3 storage. It records the outcome (success/failure) in the
// InstanceSetting_BACKUP setting regardless of the result, so the UI can always show the latest
// status.
func Run(ctx context.Context, profile *profile.Profile, stores *store.Store) error {
	runErr := run(ctx, profile, stores)

	backupSetting := &storepb.InstanceBackupSetting{
		LastBackupTime:    timestamppb.Now(),
		LastBackupSuccess: runErr == nil,
	}
	if runErr != nil {
		backupSetting.LastBackupError = runErr.Error()
	}
	if _, err := stores.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_BACKUP,
		Value: &storepb.InstanceSetting_BackupSetting{BackupSetting: backupSetting},
	}); err != nil {
		// The backup itself may have succeeded; still surface a status-recording failure so it's
		// not silently lost, but don't mask the original backup error if there was one.
		if runErr == nil {
			return errors.Wrap(err, "failed to record backup status")
		}
	}
	return runErr
}

func run(ctx context.Context, profile *profile.Profile, stores *store.Store) error {
	if profile.Driver != "sqlite" {
		return errors.New("database backup is only supported for sqlite instances")
	}

	storageSetting, err := stores.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get storage setting")
	}
	s3Config := storageSetting.GetS3Config()
	if s3Config == nil {
		return errors.New("S3 storage is not configured")
	}

	backupSetting, err := stores.GetInstanceBackupSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get backup setting")
	}

	snapshotPath, err := snapshotSQLite(ctx, stores)
	if err != nil {
		return errors.Wrap(err, "failed to snapshot database")
	}
	defer os.Remove(snapshotPath)

	gzipPath := snapshotPath + ".gz"
	if err := gzipFile(snapshotPath, gzipPath); err != nil {
		return errors.Wrap(err, "failed to compress database snapshot")
	}
	defer os.Remove(gzipPath)

	s3Client, err := s3.NewClient(ctx, s3Config)
	if err != nil {
		return errors.Wrap(err, "failed to create s3 client")
	}

	// Read the whole (already-compressed) snapshot into memory and upload from a bytes.Reader,
	// matching the attachment upload path (SaveAttachmentBlob) exactly: an io.Reader backed by an
	// *os.File has an unpredictable length to the S3 SDK until it seeks, which has been observed
	// to produce SignatureDoesNotMatch against some S3-compatible providers when the request body
	// hash is computed differently than for a fixed-size buffer. Backups are a single compressed
	// SQLite file, not a multi-GB blob, so buffering it is not a meaningful memory concern.
	snapshotBytes, err := os.ReadFile(gzipPath)
	if err != nil {
		return errors.Wrap(err, "failed to read compressed database snapshot")
	}

	key := renderPathTemplate(backupSetting.PathTemplate)
	if _, err := s3Client.UploadObject(ctx, key, "application/gzip", bytes.NewReader(snapshotBytes)); err != nil {
		return errors.Wrap(err, "failed to upload database snapshot to s3")
	}
	return nil
}

// snapshotSQLite uses SQLite's VACUUM INTO to write a consistent, point-in-time copy of the
// database to a temp file. VACUUM INTO does not block concurrent readers/writers, so this can
// run without pausing the server.
func snapshotSQLite(ctx context.Context, stores *store.Store) (string, error) {
	db := stores.GetDriver().GetDB()
	if db == nil {
		return "", errors.New("database connection is not available")
	}

	tempFile, err := os.CreateTemp("", "memos-backup-*.db")
	if err != nil {
		return "", errors.Wrap(err, "failed to create temp file")
	}
	tempPath := tempFile.Name()
	if err := tempFile.Close(); err != nil {
		os.Remove(tempPath)
		return "", errors.Wrap(err, "failed to close temp file")
	}
	// VACUUM INTO requires the destination not to already exist.
	if err := os.Remove(tempPath); err != nil {
		return "", errors.Wrap(err, "failed to prepare temp file path")
	}

	if err := vacuumInto(ctx, db, tempPath); err != nil {
		os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}

func vacuumInto(ctx context.Context, db *sql.DB, destPath string) error {
	// destPath is a server-generated temp file path, not user input, so building the statement
	// this way is safe; SQLite's VACUUM INTO does not support bind parameters for the path.
	_, err := db.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", destPath))
	if err != nil {
		return errors.Wrap(err, "failed to execute VACUUM INTO")
	}
	return nil
}

var pathTemplatePlaceholder = regexp.MustCompile(`\{[a-z]{1,9}\}`)

// renderPathTemplate expands the same placeholder set as the attachment filepath template
// ({timestamp}, {uuid}, {year}, {month}, {day}, {hour}, {minute}, {second}); there is no
// {filename} placeholder since a backup has no source filename.
func renderPathTemplate(template string) string {
	if strings.TrimSpace(template) == "" {
		template = store.DefaultInstanceBackupPathTemplate
	}
	t := time.Now().UTC()
	return pathTemplatePlaceholder.ReplaceAllStringFunc(template, func(s string) string {
		switch s {
		case "{timestamp}":
			return fmt.Sprintf("%d", t.Unix())
		case "{year}":
			return fmt.Sprintf("%d", t.Year())
		case "{month}":
			return fmt.Sprintf("%02d", t.Month())
		case "{day}":
			return fmt.Sprintf("%02d", t.Day())
		case "{hour}":
			return fmt.Sprintf("%02d", t.Hour())
		case "{minute}":
			return fmt.Sprintf("%02d", t.Minute())
		case "{second}":
			return fmt.Sprintf("%02d", t.Second())
		case "{uuid}":
			return util.GenUUID()
		default:
			return s
		}
	})
}

func gzipFile(srcPath, destPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dest, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dest.Close()

	gzWriter := gzip.NewWriter(dest)
	if _, err := io.Copy(gzWriter, src); err != nil {
		return err
	}
	return gzWriter.Close()
}
