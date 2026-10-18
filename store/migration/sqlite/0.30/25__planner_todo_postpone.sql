-- Postponing a todo moves its date; these keep the history the date alone loses.
-- original_date   the date before its first postponement, or '' if never postponed.
-- postpone_count  how many times it has been postponed.
ALTER TABLE planner_todo ADD COLUMN original_date TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_todo ADD COLUMN postpone_count INTEGER NOT NULL DEFAULT 0;
