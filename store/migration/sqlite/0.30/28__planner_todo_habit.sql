-- A todo can name a habit to check in when it is done.
-- planner_todo.habit_id      the habit, or 0 for none.
-- planner_check_in.todo_id   the todo whose completion made the check-in, or 0
--                            for one checked in by hand.
ALTER TABLE planner_todo ADD COLUMN habit_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planner_check_in ADD COLUMN todo_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_planner_check_in_todo_id ON planner_check_in(todo_id);
