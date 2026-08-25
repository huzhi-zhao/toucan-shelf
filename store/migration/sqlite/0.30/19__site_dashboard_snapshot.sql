-- The site's home page stops being a page of the site.
--
-- A `.view` document used to be published like an article in order to become a
-- home page: that left its block JSON served as a page body at a slug of its
-- own, listed in the site's contents next to the articles, and carrying the
-- knowledge base's folder paths and property rules in a response that visibly
-- rendered none of them. The layout now lives on the site row as a sanitized
-- snapshot, written when the author picks the home page in the site settings.
ALTER TABLE site ADD COLUMN dashboard_snapshot TEXT NOT NULL DEFAULT '';

-- Existing view publications go with it. Dropping them takes those pages off
-- the site; the author re-picks the home page, which writes the snapshot.
DELETE FROM site_publication
WHERE memo_id IN (SELECT id FROM memo WHERE doc_type = 'VIEW');
