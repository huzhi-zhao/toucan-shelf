// Package backup runs the weekly SQLite-to-S3 database backup as a background job.
package backup

import (
	"context"
	"log/slog"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/profile"
	backupsvc "github.com/usememos/memos/server/backup"
	"github.com/usememos/memos/store"
)

const (
	// backupInterval is how long after the last successful backup the next one becomes due.
	backupInterval = 7 * 24 * time.Hour
	// pollInterval is how often the runner re-checks whether a backup is due. The schedule
	// itself lives in InstanceBackupSetting.last_backup_time, not in this ticker: a ticker
	// alone resets on every restart, and on an instance deployed more often than
	// backupInterval that meant the automatic backup never fired at all.
	pollInterval = time.Hour
)

type Runner struct {
	Profile *profile.Profile
	Store   *store.Store
}

func NewRunner(profile *profile.Profile, store *store.Store) *Runner {
	return &Runner{
		Profile: profile,
		Store:   store,
	}
}

func (r *Runner) Run(ctx context.Context) {
	// Check at startup rather than only after the first tick, so a backup that came due while
	// the process was down is taken now instead of being skipped.
	r.RunOnce(ctx)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			r.RunOnce(ctx)
		case <-ctx.Done():
			return
		}
	}
}

// RunOnce takes a backup if one is due. It is the scheduled path; the manual BackupNow RPC
// calls the backup service directly and is never gated by the schedule.
func (r *Runner) RunOnce(ctx context.Context) {
	due, err := r.backupDue(ctx)
	if err != nil {
		slog.Info("could not determine whether a database backup is due", "error", err)
		return
	}
	if !due {
		return
	}
	if err := backupsvc.Run(ctx, r.Profile, r.Store); err != nil {
		slog.Info("scheduled database backup did not complete", "error", err)
	}
}

// backupDue reports whether the automatic backup should run now.
func (r *Runner) backupDue(ctx context.Context) (bool, error) {
	storageSetting, err := r.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return false, errors.Wrap(err, "failed to get storage setting")
	}
	if storageSetting.GetS3Config() == nil {
		// There is nowhere to upload to. Returning early instead of letting the backup service
		// fail keeps an instance that never opted into remote backups from recording a failed
		// attempt, and an error message for the UI to show, on every poll.
		return false, nil
	}

	backupSetting, err := r.Store.GetInstanceBackupSetting(ctx)
	if err != nil {
		return false, errors.Wrap(err, "failed to get backup setting")
	}
	lastBackupTime := backupSetting.GetLastBackupTime()
	if lastBackupTime == nil {
		// Never attempted on this instance.
		return true, nil
	}
	if !backupSetting.GetLastBackupSuccess() {
		// A failed attempt is retried on the next poll rather than a week later: the usual
		// cause is a transient upload error or a storage setting that was just corrected.
		return true, nil
	}
	return time.Since(lastBackupTime.AsTime()) >= backupInterval, nil
}
