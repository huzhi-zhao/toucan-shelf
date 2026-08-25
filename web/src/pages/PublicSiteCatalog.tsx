// The contents page: `/contents` on the site's own domain, `/s/{site}/contents`
// on the platform path.
//
// The tree it draws is the site's authored navigation, served with the profile
// and already pruned server-side to what is published — a node pointing at an
// unpublished document arrives with no slug, and a node with nothing published
// under it does not arrive at all. The page therefore never renders a dead link,
// and never renders a label for a document a reader cannot open: the label alone
// would say that document exists.
//
// The tree is navigation only. URLs stay flat (`/<slug>`) whatever nesting the
// author gives it, so moving a page in the tree never changes its address.

import { useMemo, useState } from "react";
import { siteByline, toBlogNav, toBlogPost } from "@/components/BlogSite/adapt";
import BlogCatalog from "@/components/BlogSite/BlogCatalog";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPages } from "@/hooks/usePublicSiteQueries";

const PublicSiteCatalog = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  const { data: pages, isLoading } = usePublicPages(siteName);
  const [selectedKey, setSelectedKey] = useState("");

  usePageTitle(`${COPY.catalogNavLabel} - ${profile.displayName}`);

  const nav = useMemo(() => toBlogNav(profile.nav), [profile.nav]);
  const posts = useMemo(() => (pages ?? []).map((page) => toBlogPost(page, byline)), [pages, byline]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }

  return (
    <BlogCatalog
      nav={nav}
      posts={posts}
      selectedKey={selectedKey}
      onSelect={(key) => setSelectedKey(key === selectedKey ? "" : key)}
      basePath={basePath}
    />
  );
};

export default PublicSiteCatalog;
