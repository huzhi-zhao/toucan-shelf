// Package storagemigration drives an in-flight attachment storage migration in the background.
//
// The migration is user-triggered, but the copying is not done inside the request: it can take
// minutes to hours, and it has to survive a restart. Keeping the whole state in the database and
// letting a ticker pick it back up means "resume after a crash" needs no recovery code -- the
// next tick simply finds rows still marked pending.
package storagemigration

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/storagemigration"
	"github.com/usememos/memos/store"
)

// tickInterval is how often the worker looks for work. Attachment writes are frozen while a
// migration runs, so the interval is a bound on how long an operator waits after pressing start,
// not on anything a user is watching.
const tickInterval = 3 * time.Second

type Runner struct {
	Store *store.Store
}

func NewRunner(store *store.Store) *Runner {
	return &Runner{Store: store}
}

func (r *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(tickInterval)
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

// RunOnce advances the migration by at most one batch. It is a no-op on instances with no
// migration in flight, which is nearly all of them nearly all of the time.
func (r *Runner) RunOnce(ctx context.Context) {
	migration, err := r.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		slog.Error("failed to read the storage migration setting", slog.String("error", err.Error()))
		return
	}
	switch migration.State {
	case storepb.InstanceStorageMigrationSetting_MIGRATING,
		storepb.InstanceStorageMigrationSetting_RECONCILING:
	default:
		return
	}

	storageSetting, err := r.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		r.recordWorkerError(ctx, migration, "failed to read the storage setting: "+err.Error())
		return
	}
	current := storageSetting.GetS3Config()
	if current == nil || migration.TargetS3Config == nil {
		r.recordWorkerError(ctx, migration, "the source or target S3 configuration is missing")
		return
	}

	if migration.State == storepb.InstanceStorageMigrationSetting_MIGRATING {
		advanced, err := storagemigration.CopyPending(ctx, r.Store, current, migration.TargetS3Config)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			r.recordWorkerError(ctx, migration, err.Error())
			return
		}
		if advanced > 0 {
			// More to do; record progress and come back next tick rather than holding the loop.
			r.saveProgress(ctx, migration, storepb.InstanceStorageMigrationSetting_MIGRATING, storepb.InstanceStorageMigrationSetting_MIGRATING, "")
			return
		}
		// Everything is copied. Publish the phase change before doing the work, so the panel
		// stops saying "copying" the moment it stops being true.
		r.saveProgress(ctx, migration, storepb.InstanceStorageMigrationSetting_MIGRATING, storepb.InstanceStorageMigrationSetting_RECONCILING, "")
		return
	}

	// Reconciliation re-checks every object at the target. "The upload returned 200" and "the
	// object is there" are different claims, and the instance is about to be pointed at the
	// second one.
	if _, err := storagemigration.Reconcile(ctx, r.Store, migration.TargetS3Config); err != nil {
		if ctx.Err() != nil {
			return
		}
		r.recordWorkerError(ctx, migration, err.Error())
		return
	}
	r.saveProgress(ctx, migration, storepb.InstanceStorageMigrationSetting_RECONCILING, storepb.InstanceStorageMigrationSetting_READY, "")
}

// saveProgress writes the per-status counts into the setting so the migration panel can be read
// from the setting alone, including after the work list has been dropped at switch time.
//
// A pass can take a while, and an operator can abandon or switch the migration in the middle of
// one. Writing back blindly would resurrect a migration that was just cleared and leave the
// instance frozen with an empty work list, so the state is re-read and the write dropped if it
// moved underneath us. Losing one batch's progress counts costs a re-stat; resurrecting a dead
// migration costs an outage.
func (r *Runner) saveProgress(ctx context.Context, migration *storepb.InstanceStorageMigrationSetting, expected, next storepb.InstanceStorageMigrationSetting_State, lastError string) {
	current, err := r.Store.GetInstanceStorageMigrationSetting(ctx)
	if err != nil {
		slog.Error("failed to re-read the storage migration setting", slog.String("error", err.Error()))
		return
	}
	if current.State != expected {
		slog.Info("storage migration changed state while a pass was running; dropping the progress write",
			slog.String("expected", expected.String()), slog.String("now", current.State.String()))
		return
	}

	counts, err := r.Store.CountAttachmentMigrationJobsByStatus(ctx)
	if err != nil {
		slog.Error("failed to count the migration work list", slog.String("error", err.Error()))
		return
	}
	progress := &storepb.InstanceStorageMigrationSetting_Progress{
		Pending: int64(counts[store.AttachmentMigrationStatusPending]),
		Done:    int64(counts[store.AttachmentMigrationStatusDone]),
		Skipped: int64(counts[store.AttachmentMigrationStatusSkipped]),
		Failed:  int64(counts[store.AttachmentMigrationStatusFailed]),
	}
	progress.Total = progress.Pending + progress.Done + progress.Skipped + progress.Failed
	migration.Progress = progress
	migration.State = next
	migration.LastError = lastError
	migration.UpdateTime = timestamppb.Now()

	if _, err := r.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_STORAGE_MIGRATION,
		Value: &storepb.InstanceSetting_StorageMigrationSetting{StorageMigrationSetting: migration},
	}); err != nil {
		slog.Error("failed to save the storage migration progress", slog.String("error", err.Error()))
	}
}

// recordWorkerError parks the migration where it is with the reason attached. It deliberately
// does not unfreeze: an operator has to look at what happened, because unfreezing would let
// uploads land in a location that is about to stop being the live one.
func (r *Runner) recordWorkerError(ctx context.Context, migration *storepb.InstanceStorageMigrationSetting, message string) {
	slog.Error("attachment storage migration stalled", slog.String("error", message))
	r.saveProgress(ctx, migration, migration.State, migration.State, message)
}
