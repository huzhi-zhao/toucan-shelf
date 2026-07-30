-- secret_block holds the client-encrypted payload behind a `toucan-secret` fenced
-- block. The server never sees plaintext and never sees the passphrase; every
-- column here is opaque to it.
--
-- A record belongs to its creator, NOT to the document that references it, so
-- there is deliberately no memo_id, no foreign key and no ON DELETE CASCADE:
-- deleting or duplicating a document must never destroy a secret, and several
-- documents may legitimately reference the same record. Orphan records are
-- accepted (a few hundred bytes each) in exchange for making "the document is
-- gone and so is the only copy of my credentials" impossible.
CREATE TABLE secret_block (
  id             SERIAL  PRIMARY KEY,
  uid            TEXT    NOT NULL UNIQUE,
  creator_id     INTEGER NOT NULL,
  hint           TEXT    NOT NULL DEFAULT '',
  kdf            TEXT    NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  cipher         TEXT    NOT NULL,
  salt           TEXT    NOT NULL,
  nonce          TEXT    NOT NULL,
  verifier       TEXT    NOT NULL,
  ciphertext     TEXT    NOT NULL,
  created_ts     BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts     BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
);

CREATE INDEX idx_secret_block_creator_id ON secret_block(creator_id);
