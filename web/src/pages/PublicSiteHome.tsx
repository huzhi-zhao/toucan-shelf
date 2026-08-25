// The site's index.
//
// Two shapes, one page: when the site has a home `.view` document, the page is
// the blocks its author arranged — served inline on the profile, because a home
// page is the site's front door rather than one of its articles: no slug, no
// listing entry, no page of its own to fetch; otherwise it is one flat feed of
// everything published to the site. Both draw their entries from ListPublicPages,
// the only source an outward-facing listing may draw from — a block never reaches
// past this site's published pages to get them.

import { useMemo, useState } from "react";
import { siteByline, toBlogPost } from "@/components/BlogSite/adapt";
import BlogBlocks from "@/components/BlogSite/BlogBlocks";
import BlogFeed, { ALL_TOPICS } from "@/components/BlogSite/BlogFeed";
import { parseBlogBlocks } from "@/components/BlogSite/blocks";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import { usePublicPages } from "@/hooks/usePublicSiteQueries";

const PublicSiteHome = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  const { data: pages, isLoading } = usePublicPages(siteName);
  const [topic, setTopic] = useState(ALL_TOPICS);

  const posts = useMemo(() => (pages ?? []).map((page) => toBlogPost(page, byline)), [pages, byline]);
  // An unparseable or empty composition falls back to the feed below. A home
  // page that will not parse is still a site with pages on it.
  const blocks = useMemo(() => (profile.dashboardContent ? parseBlogBlocks(profile.dashboardContent) : []), [profile.dashboardContent]);
  // Tags are the only grouping a snapshot carries: it has no folder and no
  // frontmatter properties, so there is nothing else to filter on out here.
  const topics = useMemo(() => [...new Set(posts.flatMap((post) => post.tags))].sort(), [posts]);
  const visible = useMemo(() => (topic === ALL_TOPICS ? posts : posts.filter((post) => post.tags.includes(topic))), [posts, topic]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }

  if (blocks.length > 0) {
    return <BlogBlocks blocks={blocks} posts={posts} basePath={basePath} feedTopic={topic} onFeedTopicChange={setTopic} />;
  }

  return (
    <div className="blog-shell py-16">
      <BlogFeed title={COPY.feedTitle} topics={topics} activeTopic={topic} onTopicChange={setTopic} posts={visible} basePath={basePath} />
    </div>
  );
};

export default PublicSiteHome;
