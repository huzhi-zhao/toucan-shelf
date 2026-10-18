-- A todo can link several documents. memo_names is a JSON array of their
-- 'memos/{uid}', in display order; '[]' for none. It replaces memo_name, which
-- held at most one.
ALTER TABLE planner_todo ADD COLUMN memo_names TEXT NOT NULL DEFAULT '[]';
UPDATE planner_todo SET memo_names = json_array(memo_name) WHERE memo_name != '';
ALTER TABLE planner_todo DROP COLUMN memo_name;
