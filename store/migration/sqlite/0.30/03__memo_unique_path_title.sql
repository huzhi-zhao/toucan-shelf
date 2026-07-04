-- Backfill empty titles so the unique index below doesn't collide: every
-- legacy memo defaulted to title = '' in the previous migration, and many
-- users have more than one such memo in the same (now-default) workspace root.
UPDATE memo SET title = 'memo-' || id WHERE title = '';

DROP INDEX idx_memo_workspace_folder;
CREATE UNIQUE INDEX idx_memo_workspace_folder_title ON memo (workspace_id, folder_path, title);
