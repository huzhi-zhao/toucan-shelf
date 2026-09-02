package sqlite

import (
	"context"
	"fmt"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) UpsertAttachmentMigrationJobs(ctx context.Context, jobs []*store.AttachmentMigrationJob) error {
	if len(jobs) == 0 {
		return nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt := "INSERT INTO `attachment_migration_job` (`attachment_id`, `source_key`, `target_key`, `status`, `size`, `attempts`, `last_error`, `updated_ts`) " +
		"VALUES (?, ?, ?, ?, ?, 0, ?, strftime('%s','now')) " +
		"ON CONFLICT(`attachment_id`) DO UPDATE SET `source_key` = excluded.`source_key`, `target_key` = excluded.`target_key`, " +
		"`status` = excluded.`status`, `size` = excluded.`size`, `attempts` = 0, `last_error` = excluded.`last_error`, `updated_ts` = strftime('%s','now')"
	for _, job := range jobs {
		status := job.Status
		if status == "" {
			status = store.AttachmentMigrationStatusPending
		}
		if _, err := tx.ExecContext(ctx, stmt, job.AttachmentID, job.SourceKey, job.TargetKey, status, job.Size, job.LastError); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) ListAttachmentMigrationJobs(ctx context.Context, find *store.FindAttachmentMigrationJob) ([]*store.AttachmentMigrationJob, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.AttachmentID != nil {
		where, args = append(where, "`attachment_id` = ?"), append(args, *find.AttachmentID)
	}
	if find.Status != nil {
		where, args = append(where, "`status` = ?"), append(args, *find.Status)
	}
	query := "SELECT `attachment_id`, `source_key`, `target_key`, `status`, `size`, `attempts`, `last_error`, `created_ts`, `updated_ts` " +
		"FROM `attachment_migration_job` WHERE " + strings.Join(where, " AND ") + " ORDER BY `attachment_id`"
	if find.Limit != nil {
		query = fmt.Sprintf("%s LIMIT %d", query, *find.Limit)
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.AttachmentMigrationJob{}
	for rows.Next() {
		job := &store.AttachmentMigrationJob{}
		if err := rows.Scan(&job.AttachmentID, &job.SourceKey, &job.TargetKey, &job.Status, &job.Size,
			&job.Attempts, &job.LastError, &job.CreatedTs, &job.UpdatedTs); err != nil {
			return nil, err
		}
		list = append(list, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateAttachmentMigrationJob(ctx context.Context, update *store.UpdateAttachmentMigrationJob) error {
	set, args := []string{"`updated_ts` = strftime('%s','now')"}, []any{}
	if update.Status != nil {
		set, args = append(set, "`status` = ?"), append(args, *update.Status)
	}
	if update.TargetKey != nil {
		set, args = append(set, "`target_key` = ?"), append(args, *update.TargetKey)
	}
	if update.Size != nil {
		set, args = append(set, "`size` = ?"), append(args, *update.Size)
	}
	if update.Attempts != nil {
		set, args = append(set, "`attempts` = ?"), append(args, *update.Attempts)
	}
	if update.LastError != nil {
		set, args = append(set, "`last_error` = ?"), append(args, *update.LastError)
	}
	args = append(args, update.AttachmentID)
	stmt := "UPDATE `attachment_migration_job` SET " + strings.Join(set, ", ") + " WHERE `attachment_id` = ?"
	_, err := d.db.ExecContext(ctx, stmt, args...)
	return err
}

func (d *DB) CountAttachmentMigrationJobsByStatus(ctx context.Context) (map[string]int, error) {
	rows, err := d.db.QueryContext(ctx, "SELECT `status`, COUNT(*) FROM `attachment_migration_job` GROUP BY `status`")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		counts[status] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return counts, nil
}

func (d *DB) ClearAttachmentMigrationJobs(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `attachment_migration_job`")
	return err
}

// ApplyAttachmentStorageMigration performs the switch in one transaction: rewrite every
// attachment's object key, swap the instance's storage setting to the target, clear the migration
// setting, and drop the work list. Half of this applied is a site-wide outage, so it is all or
// nothing. See Store.ApplyAttachmentStorageMigration.
func (d *DB) ApplyAttachmentStorageMigration(ctx context.Context, rewrites []*store.AttachmentStorageRewriteRow, settings []*store.InstanceSetting) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, rewrite := range rewrites {
		if _, err := tx.ExecContext(ctx,
			"UPDATE `attachment` SET `reference` = ?, `payload` = ? WHERE `id` = ?",
			rewrite.Reference, rewrite.Payload, rewrite.AttachmentID); err != nil {
			return err
		}
	}
	for _, setting := range settings {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO system_setting (name, value, description) VALUES (?, ?, ?) "+
				"ON CONFLICT(name) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description",
			setting.Name, setting.Value, setting.Description); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM `attachment_migration_job`"); err != nil {
		return err
	}
	return tx.Commit()
}
