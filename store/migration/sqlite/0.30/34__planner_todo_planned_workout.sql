-- A habit todo can carry the workout planned for its day, and a todo records who created it.
-- planner_todo.source                  'MANUAL' (the app) or 'AGENT' (a personal access token, e.g. a bot).
-- planner_todo.planned_workout         JSON like planner_check_in.workout; '' for none.
-- planner_todo.planned_workout_source  who last set planned_workout: 'MANUAL' or 'AGENT'; '' for none.
ALTER TABLE planner_todo ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE planner_todo ADD COLUMN planned_workout TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_todo ADD COLUMN planned_workout_source TEXT NOT NULL DEFAULT '';
