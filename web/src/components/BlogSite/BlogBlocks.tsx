import MemoContent from "@/components/MemoContent";
import { PublicSiteRenderProvider } from "@/components/MemoContent/PublicSiteRenderContext";
import BlogFeed, { ALL_TOPICS } from "./BlogFeed";
import BlogGallery from "./BlogGallery";
import { type BlogBlock, type BlogPost, selectPosts } from "./types";

interface Props {
  blocks: BlogBlock[];
  posts: BlogPost[];
  basePath: string;
  /** The topic the reader picked in a feed block's filter. */
  feedTopic: string;
  onFeedTopicChange: (topic: string) => void;
}

/**
 * Renders a composed page: the author's blocks, top to bottom.
 *
 * This is the home page's whole structure. Which blocks exist and in what order
 * is the author's arrangement, stored as configuration — nothing here is
 * generated from a template, and no block reaches past this site's published
 * pages to get its entries.
 */
const BlogBlocks = ({ blocks, posts, basePath, feedTopic, onFeedTopicChange }: Props) => (
  <div className="flex flex-col gap-20 pt-14">
    {blocks.map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === "markdown") {
        return (
          <section key={key} className="blog-shell">
            <div className="blog-md-block">
              <PublicSiteRenderProvider basePath={basePath}>
                <MemoContent content={block.content} density="reading" alwaysExpanded />
              </PublicSiteRenderProvider>
            </div>
          </section>
        );
      }
      if (block.type === "gallery") {
        return (
          <section key={key} className="blog-shell">
            <BlogGallery posts={selectPosts(posts, block)} columns={block.columns} basePath={basePath} />
          </section>
        );
      }
      const scoped = selectPosts(posts, block);
      const topics = block.showTopicFilter ? Array.from(new Set(scoped.flatMap((post) => post.tags))) : [];
      const listed = feedTopic === ALL_TOPICS ? scoped : scoped.filter((post) => post.tags.includes(feedTopic));
      return (
        <section key={key} className="blog-shell">
          <BlogFeed
            title={block.title}
            topics={topics}
            activeTopic={feedTopic}
            onTopicChange={onFeedTopicChange}
            posts={listed}
            basePath={basePath}
          />
        </section>
      );
    })}
  </div>
);

export default BlogBlocks;
