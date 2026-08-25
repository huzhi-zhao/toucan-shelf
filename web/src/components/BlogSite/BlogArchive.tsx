import { Link } from "react-router-dom";
import { blogPostPath } from "./adapt";
import { ALL_TOPICS } from "./BlogFeed";
import { COPY, formatBlogDate } from "./copy";
import type { BlogPost } from "./types";

interface Props {
  posts: BlogPost[];
  topics: string[];
  activeTopic: string;
  onTopicChange: (topic: string) => void;
  /** More entries exist on the server than are held here. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  basePath: string;
}

/** Entries grouped under the year they were last updated, newest year first. */
function byYear(posts: BlogPost[]): { year: string; posts: BlogPost[] }[] {
  const groups = new Map<string, BlogPost[]>();
  for (const post of posts) {
    // A snapshot with no date sorts last under its own heading rather than
    // being dropped: the archive's promise is that everything published is here.
    const year = post.updatedAt ? String(post.updatedAt.getFullYear()) : COPY.archiveUndated;
    groups.set(year, [...(groups.get(year) ?? []), post]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, entries]) => ({ year, posts: entries }));
}

/**
 * The archive: everything this site has published, in one list.
 *
 * It is not the home page's feed under another name. A feed block is the
 * author's front door — scoped by tag, capped by a limit, frozen into the home
 * page's layout — so "what this site has published" is a question it cannot
 * answer. This page answers it, and is the reason a site with several hundred
 * pages is still fully reachable without a search engine.
 *
 * Rows rather than cards: a reader here is scanning a list for one thing, and a
 * card wall of three hundred entries is not scannable.
 */
const BlogArchive = ({ posts, topics, activeTopic, onTopicChange, hasMore, loadingMore, onLoadMore, basePath }: Props) => (
  <div className="blog-shell pt-14">
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="blog-section-title">{COPY.archiveTitle}</h1>

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

      {posts.length === 0 ? (
        <p className="blog-muted mt-10 text-base">{COPY.feedEmpty}</p>
      ) : (
        byYear(posts).map((group) => (
          <section key={group.year} className="mt-14">
            <h2 className="blog-display text-sm tracking-wider text-[color:var(--blog-ink-muted)]">{group.year}</h2>
            <ul className="mt-5 flex flex-col">
              {group.posts.map((post) => (
                <li key={post.slug} className="border-t border-[color:var(--blog-hairline)]">
                  <Link
                    to={blogPostPath(basePath, post.slug)}
                    className="blog-link-quiet flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                  >
                    <span className="blog-underline text-lg leading-snug">{post.title}</span>
                    <span className="blog-muted shrink-0 text-sm">{formatBlogDate(post.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {hasMore && (
        <div className="mt-14 flex justify-center">
          <button type="button" className="blog-pill" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? COPY.loading : COPY.archiveLoadMore}
          </button>
        </div>
      )}
    </div>
  </div>
);

export default BlogArchive;
