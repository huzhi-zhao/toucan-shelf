// The site's index.
//
// Until P2b lets the author compose the home page out of blocks, this is one
// flat feed of everything published to the site — drawn from ListPublicPages,
// the only source an outward-facing listing may draw from.

import { useMemo, useState } from "react";
import { toBlogPost } from "@/components/BlogSite/adapt";
import BlogFeed, { ALL_TOPICS } from "@/components/BlogSite/BlogFeed";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import { usePublicPages } from "@/hooks/usePublicSiteQueries";

const PublicSiteHome = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const { data: pages, isLoading } = usePublicPages(siteName);
  const [topic, setTopic] = useState(ALL_TOPICS);

  const posts = useMemo(() => (pages ?? []).map((page) => toBlogPost(page, profile.displayName)), [pages, profile.displayName]);
  // Tags are the only grouping a snapshot carries: it has no folder and no
  // frontmatter properties, so there is nothing else to filter on out here.
  const topics = useMemo(() => [...new Set(posts.flatMap((post) => post.tags))].sort(), [posts]);
  const visible = useMemo(() => (topic === ALL_TOPICS ? posts : posts.filter((post) => post.tags.includes(topic))), [posts, topic]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }

  return (
    <div className="blog-shell py-16">
      <BlogFeed title={COPY.feedTitle} topics={topics} activeTopic={topic} onTopicChange={setTopic} posts={visible} basePath={basePath} />
    </div>
  );
};

export default PublicSiteHome;
