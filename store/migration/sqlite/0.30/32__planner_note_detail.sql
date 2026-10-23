-- A note gets a page of its own: a longer remark and linked documents, like a todo's.
ALTER TABLE planner_note ADD COLUMN remark TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_note ADD COLUMN memo_names TEXT NOT NULL DEFAULT '[]';
