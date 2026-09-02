-- attachment_migration_job is the per-attachment work list of one attachment
-- storage migration: copying every S3 object to a new (endpoint, bucket, root
-- prefix) location without changing any attachment's public URI.
--
-- attachment_id is the primary key, so "one attachment appears at most once in
-- a migration" is enforced by the database rather than by the worker. The table
-- is a workspace for a single migration, not an archive: it is emptied when the
-- migration is switched or abandoned. What has to survive (when, from where, to
-- where, how many) lives in the STORAGE_MIGRATION instance setting.
--
-- The migration never writes to the attachment table until the switch, so this
-- table holds the whole mapping in the meantime; source_key and target_key are
-- recorded per row because the target key is recomputed (directories change,
-- the file name segment is kept), which is what makes a resumed run idempotent.
--
-- status:
--   pending   - not copied yet
--   done      - object present at the target
--   skipped   - the source object does not exist; the attachment was already
--               broken before the migration and must not block it
--   failed    - the copy failed for any other reason; blocks the switch
CREATE TABLE attachment_migration_job (
  attachment_id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  size BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_attachment_migration_job_status ON attachment_migration_job(status);
