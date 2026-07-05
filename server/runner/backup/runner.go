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

// runnerInterval is how often the automatic backup runs.
const runnerInterval = 7 * 24 * time.Hour

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
	// Only sqlite instances are backed up; other drivers have their own backup tooling.
	if r.Profile.Driver != "sqlite" {
		return
	}

	ticker := time.NewTicker(runnerInterval)
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

func (r *Runner) RunOnce(ctx context.Context) {
	if r.Profile.Driver != "sqlite" {
		return
	}
	if err := backupsvc.Run(ctx, r.Profile, r.Store); err != nil {
		// Most commonly this just means S3 storage isn't configured yet, which is expected on
		// many instances; log at Info rather than Error to avoid alarming operators who never
		// opted into this feature.
		slog.Info("scheduled database backup did not complete", "error", err)
	}
}
