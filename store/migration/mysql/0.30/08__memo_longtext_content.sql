-- MySQL `TEXT` caps a column at 65,535 bytes, which silently undercut both the
-- markdown content length limit (now 1MB) and the pre-existing 10MB allowance
-- for HTML documents. SQLite and Postgres `TEXT` have no such ceiling, so only
-- MySQL needs widening. LONGTEXT holds up to 4GB.
ALTER TABLE `memo` MODIFY COLUMN `content` LONGTEXT NOT NULL;

ALTER TABLE `memo_history` MODIFY COLUMN `content` LONGTEXT NOT NULL;
