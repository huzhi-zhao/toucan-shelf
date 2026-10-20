-- Habits keep their colour for good, and versions pick which of them are in use
-- from a day on. See docs/dev/requirements/planner-and-check-in.md §2.4.2.

-- planner_habit.color  index into the calendar palette (8 colours).
ALTER TABLE planner_habit ADD COLUMN color INTEGER NOT NULL DEFAULT 0;

-- Until now a habit's colour was its rank among all of the user's habits. Keep it.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY position, id) - 1 AS rank FROM planner_habit
)
UPDATE planner_habit SET color = (SELECT rank % 8 FROM ranked WHERE ranked.id = planner_habit.id);

-- planner_habit_version is the set of habits in use from effective_date on, until
-- the next version. effective_date is 'YYYY-MM-DD', or '' for "from the very
-- beginning". entries is a JSON array of {"habit_id", "weekly_goal"} in calendar
-- order, at most five; weekly_goal 0 means none.
CREATE TABLE planner_habit_version (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id     INTEGER NOT NULL,
  effective_date TEXT    NOT NULL,
  entries        TEXT    NOT NULL DEFAULT '[]',
  created_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(creator_id, effective_date)
);

-- From the beginning: the first five habits in order, archived ones included, so
-- past months look exactly as they did.
WITH ranked AS (
  SELECT id, creator_id, ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY position, id) AS rank FROM planner_habit
)
INSERT INTO planner_habit_version (creator_id, effective_date, entries)
SELECT creator_id, '', json_group_array(json_object('habit_id', id, 'weekly_goal', 0) ORDER BY rank)
FROM ranked WHERE rank <= 5 GROUP BY creator_id;

-- From today: only the habits still in use, when that differs, so an archived
-- habit stops holding a place from now on.
WITH ranked AS (
  SELECT id, creator_id, ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY position, id) AS rank
  FROM planner_habit WHERE archived = 0
), current AS (
  SELECT creator_id, json_group_array(json_object('habit_id', id, 'weekly_goal', 0) ORDER BY rank) AS entries
  FROM ranked WHERE rank <= 5 GROUP BY creator_id
)
INSERT INTO planner_habit_version (creator_id, effective_date, entries)
SELECT current.creator_id, date('now', 'localtime'), current.entries
FROM current JOIN planner_habit_version AS first
  ON first.creator_id = current.creator_id AND first.effective_date = ''
WHERE current.entries != first.entries;
