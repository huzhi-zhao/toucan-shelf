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

CREATE UNIQUE INDEX idx_workspace_title ON workspace(title);

-- workspace_grant records which subject (currently only a user) may access which
-- knowledge base, and with what role. The team owner (the single ADMIN account)
-- never appears here: its access is implicit and unconditional.
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

-- memo_link
CREATE TABLE memo_link (
  memo_id INTEGER NOT NULL,
  target_memo_id INTEGER NOT NULL,
  UNIQUE(memo_id, target_memo_id)
);

CREATE INDEX idx_memo_link_target_memo_id ON memo_link(target_memo_id);

-- Public publishing: sites (blog spaces) and the read-only snapshots published
-- to them. See docs/dev/design/20260823-public-publishing/tech-design.md §2.
--
-- Nothing is added to `memo`: a document can be published to several sites
-- (many-to-many), snapshots are large text on a table that memogit / MCP / RAG
-- scan constantly, and publication state must stay separate from `visibility`
-- and `memo_share`.

-- site is a blog space. It belongs to a team, not to a workspace: which
-- documents a site carries is decided article by article, not by workspace
-- boundaries (requirements §3).
CREATE TABLE site (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- team_id has a single value today (the first admin's team). The column
  -- exists from the start so opening publishing up to members later is a new
  -- grant table plus a different permission check, not a data migration.
  team_id INTEGER NOT NULL DEFAULT 1,
  creator_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- domain is the custom domain the reverse proxy matches on Host. Empty until
  -- one is bound; UNIQUE is enforced by a partial index so many sites can sit
  -- at ''.
  domain TEXT NOT NULL DEFAULT '',
  domain_verified INTEGER NOT NULL DEFAULT 0,
  canonical TEXT NOT NULL CHECK (canonical IN ('PLATFORM', 'DOMAIN')) DEFAULT 'PLATFORM',
  -- status is the site-level online switch, independent of the instance's
  -- AllowAnonymous setting (requirements §11).
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ONLINE', 'OFFLINE')) DEFAULT 'DRAFT',
  -- dashboard_memo_id points at the `.view` document used as the site home
  -- page. NULL until one is chosen.
  dashboard_memo_id INTEGER,
  theme TEXT NOT NULL DEFAULT '{}',
  -- menu is the site's top menu: an ordered JSON array of {label, path}. It is
  -- site configuration rather than part of the home `.view` because it renders
  -- on every outward-facing page, and those pages do not read that document.
  menu TEXT NOT NULL DEFAULT '[]',
  search_mode TEXT NOT NULL DEFAULT 'HYBRID',
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE UNIQUE INDEX idx_site_domain ON site(domain) WHERE domain != '';
CREATE INDEX idx_site_team_id ON site(team_id);

-- site_publication is one snapshot: the output of the publish pipeline for one
-- document on one site. Readers only ever see rows from this table.
CREATE TABLE site_publication (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  site_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  -- slug is generated once on first publish and then frozen: regenerating it
  -- on a title change would break every external link.
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  -- content is the pipeline output: secret blocks removed, links rewritten.
  content TEXT NOT NULL DEFAULT '',
  -- meta carries the outward-facing extras (tags, OG fields, cross-site
  -- canonical pointer) as JSON.
  meta TEXT NOT NULL DEFAULT '{}',
  -- source_updated_ts is the source document's updated_ts at snapshot time,
  -- which is what tells the editor "the published version is behind".
  source_updated_ts BIGINT NOT NULL DEFAULT 0,
  -- state is an enum, not a bool, so adding 'PENDING' (review queue) later
  -- costs nothing.
  state TEXT NOT NULL CHECK (state IN ('PUBLISHED', 'UNPUBLISHED', 'PENDING')) DEFAULT 'PUBLISHED',
  publisher_id INTEGER NOT NULL,
  published_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(site_id, slug),
  UNIQUE(site_id, memo_id),
  FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_site_publication_site_state ON site_publication(site_id, state);
CREATE INDEX idx_site_publication_memo_id ON site_publication(memo_id);

-- site_publication_attachment records which attachments a snapshot references.
-- Publishing never changes an attachment's access — making a file public stays a
-- separate act by whoever owns it — so this table is a reference index, not a
-- grant ledger: it answers "which live pages would break if this file went
-- private again".
CREATE TABLE site_publication_attachment (
  publication_id INTEGER NOT NULL,
  attachment_id INTEGER NOT NULL,
  UNIQUE(publication_id, attachment_id),
  FOREIGN KEY (publication_id) REFERENCES site_publication(id) ON DELETE CASCADE
);

CREATE INDEX idx_site_publication_attachment_attachment_id ON site_publication_attachment(attachment_id);

-- site_publication_link records the in-site document links frozen into a
-- snapshot. It is deliberately not merged with memo_link: that table indexes
-- the live body, which diverges from the snapshot the moment the author edits
-- again, and taking a page down needs to ask "does any snapshot point at me".
CREATE TABLE site_publication_link (
  publication_id INTEGER NOT NULL,
  target_memo_id INTEGER NOT NULL,
  raw_href TEXT NOT NULL DEFAULT '',
  UNIQUE(publication_id, target_memo_id),
  FOREIGN KEY (publication_id) REFERENCES site_publication(id) ON DELETE CASCADE
);

CREATE INDEX idx_site_publication_link_target_memo_id ON site_publication_link(target_memo_id);
