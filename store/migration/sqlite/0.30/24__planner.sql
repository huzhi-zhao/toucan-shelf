-- Planner: habits with daily check-ins, todos and notes. Personal data only —
-- every row belongs to its creator and none references the knowledge-base
-- tables, so nothing here is touched by document or workspace changes. See
-- docs/dev/requirements/planner-and-check-in.md.
--
-- Dates are 'YYYY-MM-DD' text in the user's phone-local calendar; the server
-- never converts them. A todo's date may be '' (no date).

-- planner_habit is one long-running habit the user checks in against.
-- archived  1 hides it from new check-ins while keeping its history visible.
CREATE TABLE planner_habit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_planner_habit_creator_id ON planner_habit(creator_id);

-- planner_check_in records that a habit was kept on a day. One per habit per day.
CREATE TABLE planner_check_in (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  habit_id   INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(habit_id, date)
);

CREATE INDEX idx_planner_check_in_creator_date ON planner_check_in(creator_id, date);

-- planner_todo is a plan made ahead of time.
-- status          'active' | 'done' | 'cancelled'. "Overdue" is not stored: it is
--                 an active todo whose date has passed, worked out by the client.
-- closed_overdue  1 when the todo was closed after its date had passed.
-- closed_ts       when it was closed; 0 while active or when unknown (imported).
-- memo_name       'memos/{uid}' of a linked document, or ''. A plain reference.
CREATE TABLE planner_todo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT    NOT NULL UNIQUE,
  creator_id     INTEGER NOT NULL,
  title          TEXT    NOT NULL,
  date           TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'active',
  closed_overdue INTEGER NOT NULL DEFAULT 0,
  closed_ts      BIGINT  NOT NULL DEFAULT 0,
  cancel_reason  TEXT    NOT NULL DEFAULT '',
  important      INTEGER NOT NULL DEFAULT 0,
  tag            TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT '',
  memo_name      TEXT    NOT NULL DEFAULT '',
  url            TEXT    NOT NULL DEFAULT '',
  created_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_planner_todo_creator_status ON planner_todo(creator_id, status);
CREATE INDEX idx_planner_todo_creator_date ON planner_todo(creator_id, date);

-- planner_note is a plain record of what happened on a day. Named apart from
-- `memo`, which is a knowledge-base document.
CREATE TABLE planner_note (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_planner_note_creator_date ON planner_note(creator_id, date);
