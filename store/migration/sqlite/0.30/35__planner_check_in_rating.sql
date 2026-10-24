-- A check-in can be rated.
-- planner_check_in.rating  how the session went, 1 to 5; 0 when not rated.
ALTER TABLE planner_check_in ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
