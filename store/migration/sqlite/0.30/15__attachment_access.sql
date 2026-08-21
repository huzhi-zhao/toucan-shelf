-- Attachment-level access moves from `payload.locked` (a bool) to
-- `payload.access` (a three-state enum), so that "locked and public" stops being
-- a representable state once ACCESS_PUBLIC exists. See
-- docs/dev/requirements/attachments/access-control-and-private-files.md, 决策 5.
--
-- protojson writes enums as their name, which is why the value below is the
-- literal "ACCESS_LOCKED" rather than 1. `locked` is deliberately left in place
-- as a mirror the write path keeps updating: a rollback to a binary that predates
-- `access` then still sees locked attachments as locked. The read path also keeps
-- a LEGACY-COMPAT fallback for any row that never went through this statement.
UPDATE attachment
SET payload = json_set(payload, '$.access', 'ACCESS_LOCKED')
WHERE json_valid(payload)
  AND json_extract(payload, '$.locked') = 1
  AND json_extract(payload, '$.access') IS NULL;
