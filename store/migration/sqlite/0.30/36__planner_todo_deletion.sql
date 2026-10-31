-- A record of each deleted todo, so a client syncing todos (ListTodoChanges) can learn it is gone.
CREATE TABLE planner_todo_deletion (
  uid        TEXT    NOT NULL PRIMARY KEY,
  creator_id INTEGER NOT NULL,
  deleted_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_planner_todo_deletion_creator_ts ON planner_todo_deletion(creator_id, deleted_ts);
