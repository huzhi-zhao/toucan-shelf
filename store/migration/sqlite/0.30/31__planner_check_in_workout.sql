-- A check-in records who made it, and can carry the workout it stands for.
-- planner_check_in.source   'MANUAL' (the app), 'TODO' (completing a habit todo in the app)
--                           or 'AGENT' (an API caller with a personal access token, e.g. a bot).
-- planner_check_in.workout  JSON: the workout's total minutes and its exercises; '' for none.
ALTER TABLE planner_check_in ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE planner_check_in ADD COLUMN workout TEXT NOT NULL DEFAULT '';

UPDATE planner_check_in SET source = 'TODO' WHERE todo_id != 0;
