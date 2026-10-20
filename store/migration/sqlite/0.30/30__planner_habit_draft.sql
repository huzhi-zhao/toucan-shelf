-- A habit plan is drafted first and takes effect only when enabled, on that day.
-- planner_habit_version.memo_names  JSON array of the documents linked to the plan,
--                                   as 'memos/{uid}', in display order.
-- planner_habit_draft               a user's one plan not yet enabled.
ALTER TABLE planner_habit_version ADD COLUMN memo_names TEXT NOT NULL DEFAULT '[]';

CREATE TABLE planner_habit_draft (
  creator_id INTEGER PRIMARY KEY,
  entries    TEXT    NOT NULL DEFAULT '[]',
  memo_names TEXT    NOT NULL DEFAULT '[]',
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);
