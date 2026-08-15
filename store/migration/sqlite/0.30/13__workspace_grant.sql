-- workspace_grant records which subject (currently only a user) may access which
-- knowledge base, and with what role. The team owner (the single ADMIN account)
-- never appears here: its access is implicit and unconditional, which keeps
-- "admin removed itself from a workspace" from being a representable state.
--
-- subject_type is deliberately a string rather than a two-valued flag: a future
-- TEAM subject reuses this table instead of getting one of its own.
CREATE TABLE workspace_grant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'USER',
  subject_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  granted_by INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(workspace_id, subject_type, subject_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX idx_workspace_grant_subject ON workspace_grant(subject_type, subject_id);
