-- system_setting
CREATE TABLE system_setting (
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(name)
);

-- user
CREATE TABLE user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  row_status TEXT NOT NULL CHECK (row_status IN ('NORMAL', 'ARCHIVED')) DEFAULT 'NORMAL',
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'USER',
  email TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

-- user_setting
CREATE TABLE user_setting (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- memo
CREATE TABLE memo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  row_status TEXT NOT NULL CHECK (row_status IN ('NORMAL', 'ARCHIVED')) DEFAULT 'NORMAL',
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PROTECTED', 'PRIVATE')) DEFAULT 'PRIVATE',
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)) DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  workspace_id INTEGER NOT NULL DEFAULT 0,
  folder_path TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'MARKDOWN'
);
CREATE UNIQUE INDEX idx_memo_workspace_folder_title ON memo (workspace_id, folder_path, title);

-- memo_relation
CREATE TABLE memo_relation (
  memo_id INTEGER NOT NULL,
  related_memo_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(memo_id, related_memo_id, type)
);

-- memo_history
CREATE TABLE memo_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  memo_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_memo_history_memo_id ON memo_history (memo_id, created_ts);

-- workspace
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  sort_field TEXT NOT NULL DEFAULT 'createTime',
  sort_order TEXT NOT NULL DEFAULT 'desc',
  cover_color TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  folders_first INTEGER NOT NULL DEFAULT 0,
  -- Stable directory name for this workspace in attachment storage. Derived from the
  -- title once, then frozen: object keys already written must keep resolving.
  storage_slug TEXT NOT NULL DEFAULT '',
  -- Manual shelf position. Smaller sorts first; duplicates fall back to created_ts.
  display_order INTEGER NOT NULL DEFAULT 0,
  -- Soft delete: hidden workspaces are excluded from list entry points but stay
  -- readable by UID so they can be restored.
  hidden INTEGER NOT NULL DEFAULT 0
);

-- workspace_folder
CREATE TABLE workspace_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(workspace_id, path)
);

-- attachment
CREATE TABLE attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  filename TEXT NOT NULL DEFAULT '',
  blob BLOB DEFAULT NULL,
  type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  memo_id INTEGER,
  storage_type TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);

-- idp
CREATE TABLE idp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  identifier_filter TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}'
);

-- inbox
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '{}'
);

-- reaction
CREATE TABLE reaction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  creator_id INTEGER NOT NULL,
  content_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  UNIQUE(creator_id, content_id, reaction_type)
);

-- memo_share
CREATE TABLE memo_share (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL UNIQUE,
  memo_id    INTEGER NOT NULL,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_ts BIGINT  DEFAULT NULL,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_share_memo_id ON memo_share(memo_id);

-- user_identity
CREATE TABLE user_identity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  provider   TEXT    NOT NULL,
  extern_uid TEXT    NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (provider, extern_uid),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_identity_user_id ON user_identity(user_id);
-- RAG search: chunk store, full-text index, and incremental index queue.

-- memo_chunk holds the chunked, per-fragment content and (optional) embedding
-- vector for a memo. Embedding-related columns stay empty until an embedding
-- model is configured, so full-text search works standalone.
CREATE TABLE memo_chunk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 0,
  folder_path TEXT NOT NULL DEFAULT '',
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT NOT NULL DEFAULT '',
  embedding_dim INTEGER NOT NULL DEFAULT 0,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_memo_chunk_memo_id ON memo_chunk(memo_id);
CREATE INDEX idx_memo_chunk_workspace_id ON memo_chunk(workspace_id);

-- memo_chunk_fts is a standalone FTS5 index over chunk content. rowid is kept
-- equal to memo_chunk.id so the application layer can sync it directly. The
-- trigram tokenizer gives substring matching that works for CJK without an
-- external word segmenter.
CREATE VIRTUAL TABLE memo_chunk_fts USING fts5(content, tokenize='trigram');

-- memo_index_job is the incremental (re)index queue. One row per memo (memo_id
-- is the primary key), upserted whenever a memo needs indexing.
CREATE TABLE memo_index_job (
  memo_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT 'updated',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_memo_index_job_status ON memo_index_job(status);

-- secret_block
CREATE TABLE secret_block (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts     BIGINT  NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_secret_block_creator_id ON secret_block(creator_id);
