// A standalone preview of the blog skin, driven by fixtures.
//
// Its only job is to let the outward-facing look be judged before any of it is
// wired to real data — no site has to exist, nothing has to be published, and no
// backend has to be running. It touches no API, so it can never reach the
// knowledge base. Delete this page, its route and `previewFixtures.ts` once the
// skin renders real publication records.
//
// Open http://localhost:3001/blog-preview

import { useMemo, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import BlogArticle from "@/components/BlogSite/BlogArticle";
import BlogBlocks from "@/components/BlogSite/BlogBlocks";
import BlogCatalog from "@/components/BlogSite/BlogCatalog";
import { ALL_TOPICS } from "@/components/BlogSite/BlogFeed";
import BlogSearch from "@/components/BlogSite/BlogSearch";
import BlogShell from "@/components/BlogSite/BlogShell";
import { COPY } from "@/components/BlogSite/copy";
import { previewChrome, previewHome, previewNav, previewPosts } from "@/components/BlogSite/previewFixtures";

const BASE_PATH = "/blog-preview";

const NotFound = () => (
  <div className="blog-shell py-32 text-center">
    <p className="blog-display text-2xl">{COPY.notFoundTitle}</p>
    <Link to={BASE_PATH} className="blog-muted mt-4 inline-block text-sm hover:text-[color:var(--blog-ink)]">
      {COPY.notFoundBack}
    </Link>
  </div>
);

const ArticleScreen = () => {
  const { slug = "" } = useParams();
  const post = previewPosts.find((p) => p.slug === slug);
  return post ? <BlogArticle post={post} basePath={BASE_PATH} /> : <NotFound />;
};

const BlogPreview = () => {
  const [topic, setTopic] = useState(ALL_TOPICS);
  const [navKey, setNavKey] = useState("");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return previewPosts.filter((post) =>
      [post.title, post.summary ?? "", post.content ?? "", post.tags.join(" ")].join("\n").toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <BlogShell chrome={previewChrome} basePath={BASE_PATH}>
      <Routes>
        <Route
          index
          element={
            <BlogBlocks blocks={previewHome} posts={previewPosts} basePath={BASE_PATH} feedTopic={topic} onFeedTopicChange={setTopic} />
          }
        />
        <Route
          path="catalog"
          element={<BlogCatalog nav={previewNav} posts={previewPosts} selectedKey={navKey} onSelect={setNavKey} basePath={BASE_PATH} />}
        />
        <Route path="search" element={<BlogSearch query={query} onQueryChange={setQuery} results={results} basePath={BASE_PATH} />} />
        <Route path=":slug" element={<ArticleScreen />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BlogShell>
  );
};

export default BlogPreview;
