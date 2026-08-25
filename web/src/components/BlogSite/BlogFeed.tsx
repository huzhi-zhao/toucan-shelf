import { Link } from "react-router-dom";
import { blogPostPath } from "./adapt";
import { COPY, formatBlogDate } from "./copy";
import type { BlogPost } from "./types";

/**
 * One entry in a feed: cover on the left, text on the right, at a size meant to
 * be read from across the room rather than scanned. This is the shape the
 * knowledge base's gallery cards deliberately are not — a card wall packs many
 * small tiles, a feed gives a handful of entries the whole width.
 */
export const BlogFeedEntry = ({ post, basePath }: { post: BlogPost; basePath: string }) => (
  <article>
    <Link
      to={blogPostPath(basePath, post.slug)}
      className="blog-link-quiet group grid gap-6 sm:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-12"
    >
      {post.coverUrl && <img src={post.coverUrl} alt="" loading="lazy" className="blog-cover" />}
      <div className="flex flex-col justify-center py-1">
        {post.tags.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="blog-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        <h2 className="blog-entry-title">{post.title}</h2>
        {post.summary && <p className="blog-muted mt-4 text-base leading-relaxed">{post.summary}</p>}
        <div className="blog-muted mt-7 flex flex-wrap items-center gap-x-3 text-[0.9375rem]">
          {post.byline && <span>{post.byline}</span>}
          {post.byline && post.updatedAt && <span aria-hidden>·</span>}
          {post.updatedAt && <span>{formatBlogDate(post.updatedAt)}</span>}
        </div>
      </div>
    </Link>
  </article>
);

interface Props {
  title: string;
  /** Topic filter shown in the left rail. Empty list hides the whole filter. */
  topics: string[];
  activeTopic: string;
  onTopicChange: (topic: string) => void;
  posts: BlogPost[];
  basePath: string;
}

/** Label of the "no filter" pill. Not a topic, so it is kept out of `topics`. */
export const ALL_TOPICS = "";

/**
 * A feed block: a section title and topic filter in a narrow left rail, the
 * entries in a wide right column.
 *
 * The filter is by tag, which is the only grouping a published page carries —
 * a snapshot has no folder and no frontmatter properties, so the knowledge
 * base's folder/property scope rules have nothing to match on out here.
 */
const BlogFeed = ({ title, topics, activeTopic, onTopicChange, posts, basePath }: Props) => (
  <div className="grid gap-y-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-x-[clamp(2.5rem,6vw,7rem)]">
    <div className="lg:sticky lg:top-28 lg:self-start">
      <h1 className="blog-section-title">{title}</h1>
      {topics.length > 0 && (
        <>
          <p className="blog-muted mt-8 text-sm">{COPY.feedFilterLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="blog-pill" data-on={activeTopic === ALL_TOPICS} onClick={() => onTopicChange(ALL_TOPICS)}>
              {COPY.feedAllTopics}
            </button>
            {topics.map((topic) => (
              <button key={topic} type="button" className="blog-pill" data-on={activeTopic === topic} onClick={() => onTopicChange(topic)}>
                {topic}
              </button>
            ))}
          </div>
        </>
      )}
    </div>

    <div className="min-w-0">
      {posts.length === 0 ? (
        <p className="blog-muted text-base">{COPY.feedEmpty}</p>
      ) : (
        posts.map((post, index) => (
          <div key={post.slug}>
            {index > 0 && <hr className="blog-rule my-12" />}
            <BlogFeedEntry post={post} basePath={basePath} />
          </div>
        ))
      )}
      {/* A feed is a slice — scoped by tag, capped by a limit, frozen into the
          home page's layout. The way out to the complete list belongs at its
          foot, or a reader has no way to learn the rest exists. */}
      <div className="mt-14">
        <Link to={`${basePath}/archive`} className="blog-pill inline-block">
          {COPY.archiveSeeAll}
        </Link>
      </div>
    </div>
  </div>
);

export default BlogFeed;
