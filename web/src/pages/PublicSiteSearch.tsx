// In-site search: `/search` on the site's own domain, `/s/{site}/search` on the
// platform path.
//
// The matching happens on the server, over this site's publication snapshots
// only. Two things follow from that and neither is incidental: a reader searches
// the whole published body, not just the titles the feed happened to load; and
// the knowledge-base index is never touched, so a word the author wrote after
// publishing cannot surface the article. See tech-design.md §5.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { siteByline, toBlogPost } from "@/components/BlogSite/adapt";
import BlogSearch from "@/components/BlogSite/BlogSearch";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPageSearch } from "@/hooks/usePublicSiteQueries";

// Long enough that a typed word is one request rather than one per keystroke,
// short enough that results feel like they follow the typing.
const DEBOUNCE_MS = 250;

const PublicSiteSearch = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  // The query lives in the URL so a result list can be linked and reloaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);

  usePageTitle(`${COPY.searchTitle} - ${profile.displayName}`);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSearchParams(debounced.trim() ? { q: debounced.trim() } : {}, { replace: true });
  }, [debounced, setSearchParams]);

  const { data: pages, isFetching } = usePublicPageSearch(siteName, debounced);
  const results = useMemo(() => (pages ?? []).map((page) => toBlogPost(page, byline)), [pages, byline]);

  return <BlogSearch query={query} onQueryChange={setQuery} results={results} loading={isFetching} basePath={basePath} />;
};

export default PublicSiteSearch;
