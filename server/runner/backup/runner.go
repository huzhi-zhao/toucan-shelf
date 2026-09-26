// Package backup runs the weekly SQLite-to-S3 database backup as a background job.
package backup

import (
	"context"
	"log/slog"
	"time"

	"github.com/usememos/memos/internal/profile"
	backupsvc "github.com/usememos/memos/server/backup"
	"github.com/usememos/memos/store"
)

const (
	backupInterval = 7 * 24 * time.Hour
	retryInterval  = time.Hour
	checkInterval  = time.Hour
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
	// Check immediately after startup, then recheck often enough to notice manual
	// backups and newly configured S3 without restarting the server.
	r.runIfDue(ctx, time.Now())
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			r.runIfDue(ctx, time.Now())
		case <-ctx.Done():
			return
		}
	}
}

func (r *Runner) runIfDue(ctx context.Context, now time.Time) {
	if ctx.Err() != nil {
		return
	}
	storageSetting, err := r.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		slog.Error("failed to check database backup storage", "error", err)
		return
	}
	if storageSetting.GetS3Config() == nil {
		return
	}
	backupSetting, err := r.Store.GetInstanceBackupSetting(ctx)
	if err != nil {
		slog.Error("failed to check database backup status", "error", err)
		return
	}
	lastBackupTime := backupSetting.GetLastBackupTime()
	if lastBackupTime == nil || backupDue(lastBackupTime.AsTime(), backupSetting.GetLastBackupSuccess(), now) {
		r.RunOnce(ctx)
	}
}

func backupDue(last time.Time, success bool, now time.Time) bool {
	interval := retryInterval
	if success {
		interval = backupInterval
	}
	return !now.Before(last.Add(interval))
}

func (r *Runner) RunOnce(ctx context.Context) {
	if err := backupsvc.Run(ctx, r.Profile, r.Store); err != nil {
		// Runs are scheduled only when S3 is configured; a failed upload or snapshot
		// needs operator attention.
		slog.Error("scheduled database backup did not complete", "error", err)
	}
}
