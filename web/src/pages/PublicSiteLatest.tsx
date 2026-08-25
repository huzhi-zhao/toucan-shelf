// The latest posts: `/latest` on the site's own domain, `/s/{site}/latest` on
// the platform path.
//
// It is the plain reverse-chronological feed the home page shows only when its
// author has arranged nothing else. Once a site has a home `.view`, the root is
// a curated front door — scoped by tag, capped by a limit, frozen at publish
// time — and "what did this site post recently" no longer has a page. That is
// what this one answers, which is also why it is not the same tab as Home.
//
// Not the archive either: this is one screenful of the newest entries, while the
// archive is the complete list, grouped by year and loaded a page at a time.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { siteByline, toBlogPost } from "@/components/BlogSite/adapt";
import BlogFeed, { ALL_TOPICS } from "@/components/BlogSite/BlogFeed";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPages } from "@/hooks/usePublicSiteQueries";

const PublicSiteLatest = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  const { data: pages, isLoading } = usePublicPages(siteName);
  const [topic, setTopic] = useState(ALL_TOPICS);

  usePageTitle(`${COPY.feedTitle} - ${profile.displayName}`);

  const posts = useMemo(() => (pages ?? []).map((page) => toBlogPost(page, byline)), [pages, byline]);
  const topics = useMemo(() => [...new Set(posts.flatMap((post) => post.tags))].sort(), [posts]);
  const visible = useMemo(() => (topic === ALL_TOPICS ? posts : posts.filter((post) => post.tags.includes(topic))), [posts, topic]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }

  return (
    <div className="blog-shell py-16">
      <BlogFeed title={COPY.feedTitle} topics={topics} activeTopic={topic} onTopicChange={setTopic} posts={visible} basePath={basePath} />
      {/* This listing is one page of the newest entries, not everything the
          site has — say so, and point at the page that is. */}
      <div className="mt-16 text-center">
        <Link to={`${basePath}/archive`} className="blog-link-quiet blog-underline text-sm">
          {COPY.archiveSeeAll}
        </Link>
      </div>
    </div>
  );
};

export default PublicSiteLatest;
