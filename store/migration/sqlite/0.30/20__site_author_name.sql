-- The byline shown on every page of a site.
--
-- Site configuration, deliberately not the publisher's account: a login name is
-- half of a credential pair, and in a team the byline would otherwise follow
-- whoever happened to click "publish" rather than who wrote the page. Empty
-- falls back to the site's display name, which is what every existing site was
-- already showing.
ALTER TABLE site ADD COLUMN author_name TEXT NOT NULL DEFAULT '';
