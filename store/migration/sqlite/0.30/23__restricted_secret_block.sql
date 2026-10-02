-- Restricted secret blocks: a server-enforced time gate in front of a secret
-- block's envelope. See docs/dev/requirements/editor/restricted-secret-block.md.
--
-- policy                  JSON policy; '' means the block is not restricted.
-- pending_policy          JSON policy a scheduled change will apply; '' with a
--                         non-zero pending_policy_effective_ts lifts the restriction.
-- pending_policy_effective_ts  0 when nothing is scheduled.
ALTER TABLE secret_block ADD COLUMN policy TEXT NOT NULL DEFAULT '';
ALTER TABLE secret_block ADD COLUMN pending_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE secret_block ADD COLUMN pending_policy_effective_ts BIGINT NOT NULL DEFAULT 0;

-- One row per unlock request, emergency or not. Rows are never deleted while the
-- block exists: the emergency quota and "last emergency unlock" are read from here.
--
-- kind          'normal' | 'emergency'
-- opened_ts     when the envelope was first served (0 = not yet)
-- expires_ts    end of the viewing window (0 = not opened)
-- canceled_ts   0 unless the owner withdrew the request while it was waiting
CREATE TABLE secret_block_unlock (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  secret_block_id INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  reason          TEXT    NOT NULL DEFAULT '',
  requested_ts    BIGINT  NOT NULL,
  available_ts    BIGINT  NOT NULL,
  opened_ts       BIGINT  NOT NULL DEFAULT 0,
  expires_ts      BIGINT  NOT NULL DEFAULT 0,
  canceled_ts     BIGINT  NOT NULL DEFAULT 0
);

CREATE INDEX idx_secret_block_unlock_block_id ON secret_block_unlock(secret_block_id, requested_ts);
