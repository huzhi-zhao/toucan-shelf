-- Where a version came from. Versions used to be human-made only, so every
-- existing row defaults to 'manual' and keeps its current behaviour: kept
-- forever, never pruned.
--
--   manual         - the user pressed "save as version" and named it.
--   auto           - written by the editor's auto-save before it overwrote the
--                    stored content. Subject to retention (age + count), since
--                    these accumulate on their own.
--   agent_baseline - the last human-authored state before an AI write. Kept
--                    forever like a manual version: once an agent has
--                    overwritten it, this row is the only copy of what the
--                    human wrote.
ALTER TABLE memo_history ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

-- Before this column existed the two kinds were told apart by display name
-- alone; that literal is the only signal older rows carry.
UPDATE memo_history SET source = 'agent_baseline' WHERE name = 'AI 编辑前';

-- Retention prunes "the auto versions of this memo, oldest first", which is
-- exactly this index's order.
CREATE INDEX idx_memo_history_memo_id_source ON memo_history (memo_id, source, created_ts);
