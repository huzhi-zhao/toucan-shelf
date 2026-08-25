-- The site's navigation tree: nested {label, slug, children}, stored as JSON.
--
-- Authored on the site, not derived from where the source documents live: a
-- published page's URL is flat and a site may aggregate several knowledge
-- bases, so there is no folder structure to derive a tree from. See
-- docs/dev/requirements/public-site-front-end.md §4.
ALTER TABLE site ADD COLUMN nav TEXT NOT NULL DEFAULT '[]';
