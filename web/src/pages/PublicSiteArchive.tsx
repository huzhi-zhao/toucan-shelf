// The archive: `/archive` on the site's own domain, `/s/{site}/archive` on the
// platform path.
//
// It exists because the home page cannot answer "what has this site published".
// A home page is a frozen layout of feed and gallery blocks, each scoped by tag
// and capped by a limit; it is a front door, not an index. Sending a reader to
// the home feed instead would also make "everything" change whenever the author
// rearranges the front door, which is not what everything means.
//
// Entries arrive a page at a time and the reader asks for more, rather than the
// page requesting one huge listing: the number of published pages only grows,
// and a single request would be cut off at the server's page size with nothing
// on screen to say so.

import { useMemo, useState } from "react";
import { siteByline, toBlogPost } from "@/components/BlogSite/adapt";
import BlogArchive from "@/components/BlogSite/BlogArchive";
import { ALL_TOPICS } from "@/components/BlogSite/BlogFeed";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPagesArchive } from "@/hooks/usePublicSiteQueries";

const PublicSiteArchive = () => {
  const { siteName, basePath, profile } = usePublicSite();
  const byline = siteByline(profile);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = usePublicPagesArchive(siteName);
  const [topic, setTopic] = useState(ALL_TOPICS);

  usePageTitle(`${COPY.archiveTitle} - ${profile.displayName}`);

  const posts = useMemo(() => (data?.pages ?? []).flatMap((page) => page.pages).map((page) => toBlogPost(page, byline)), [data, byline]);
  // Built from what is loaded, so the chips grow as the reader loads more. The
  // alternative — a complete tag list up front — is a listing of its own, and a
  // tag on it that matches nothing loaded would filter the page down to nothing.
  const topics = useMemo(() => [...new Set(posts.flatMap((post) => post.tags))].sort(), [posts]);
  const visible = useMemo(() => (topic === ALL_TOPICS ? posts : posts.filter((post) => post.tags.includes(topic))), [posts, topic]);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }

  return (
    <BlogArchive
      posts={visible}
      topics={topics}
      activeTopic={topic}
      onTopicChange={setTopic}
      hasMore={Boolean(hasNextPage)}
      loadingMore={isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      basePath={basePath}
    />
  );
};

export default PublicSiteArchive;
