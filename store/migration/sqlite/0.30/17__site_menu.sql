-- The site's top menu: an ordered list of {label, path}, stored as JSON.
--
-- It lives on the site rather than in the home `.view` document because the
-- menu has to render on every outward-facing page — article, search, contents —
-- and none of those render that document. See
-- docs/dev/requirements/public-site-front-end.md §1.
ALTER TABLE site ADD COLUMN menu TEXT NOT NULL DEFAULT '[]';
