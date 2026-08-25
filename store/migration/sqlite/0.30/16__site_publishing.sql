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
