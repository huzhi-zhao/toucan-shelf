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
CREATE TABLE `secret_block` (
  `id`             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid`            VARCHAR(256) NOT NULL UNIQUE,
  `creator_id`     INT          NOT NULL,
  `hint`           VARCHAR(256) NOT NULL DEFAULT '',
  `kdf`            VARCHAR(64)  NOT NULL,
  `kdf_iterations` INT          NOT NULL,
  `cipher`         VARCHAR(64)  NOT NULL,
  `salt`           VARCHAR(256) NOT NULL,
  `nonce`          VARCHAR(256) NOT NULL,
  `verifier`       VARCHAR(256) NOT NULL,
  `ciphertext`     TEXT         NOT NULL,
  `created_ts`     BIGINT       NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts`     BIGINT       NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  INDEX `idx_secret_block_creator_id` (`creator_id`)
);
