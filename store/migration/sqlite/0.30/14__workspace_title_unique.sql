-- Workspace titles become globally unique: only the team owner creates knowledge
-- bases, so "two different people happened to pick the same title" is no longer a
-- case worth modelling, and a unique title is what lets a workspace be addressed
-- by name.
--
-- Kept as its own migration step, separate from 13__workspace_grant.sql, so that a
-- future multi-team model can narrow the constraint back to (creator, title)
-- without having to unpick the grant table along with it.
--
-- Pre-existing duplicates abort the upgrade rather than being silently renamed.
-- The scratch table exists only so the failure names this check instead of
-- surfacing as an opaque index-creation error; list the offending rows with:
--   SELECT title, COUNT(*) FROM workspace GROUP BY title HAVING COUNT(*) > 1;
CREATE TABLE duplicate_workspace_title_check (title TEXT NOT NULL UNIQUE);

INSERT INTO duplicate_workspace_title_check (title) SELECT title FROM workspace;

DROP TABLE duplicate_workspace_title_check;

CREATE UNIQUE INDEX idx_workspace_title ON workspace(title);
