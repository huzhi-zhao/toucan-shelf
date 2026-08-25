// One published page: `/<slug>` on the site's own domain, `/s/{site}/<slug>` on
// the platform path.
//
// The body is the frozen snapshot the publish pipeline produced — secret blocks
// already stripped, in-site links already rewritten — rendered through the same
// markdown renderer the app uses, in its public mode: same typography, none of
// the behaviours that only make sense while signed in. The skin changes the page
// around the text, not the text itself.

import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { siteByline, toBlogPost } from "@/components/BlogSite/adapt";
import BlogArticle from "@/components/BlogSite/BlogArticle";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPage } from "@/hooks/usePublicSiteQueries";

const PublicSitePage = () => {
  const { slug = "" } = useParams();
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  const { data: page, isLoading, isError } = usePublicPage(siteName, slug);

  usePageTitle(page?.title ? `${page.title} - ${profile.displayName}` : profile.displayName);

  const post = useMemo(() => (page ? toBlogPost(page, byline) : null), [page, byline]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }
  if (isError || !post) {
    return (
      <div className="blog-shell py-32 text-center">
        <p className="blog-display text-2xl">{COPY.notFoundTitle}</p>
        <Link to={basePath || "/"} className="blog-muted mt-4 inline-block text-sm hover:text-[color:var(--blog-ink)]">
          {COPY.notFoundBack}
        </Link>
      </div>
    );
  }

  return <BlogArticle post={post} basePath={basePath} />;
};

export default PublicSitePage;
