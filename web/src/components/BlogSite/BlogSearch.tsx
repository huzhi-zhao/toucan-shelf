import { SearchIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { blogPostPath } from "./adapt";
import { COPY, formatBlogDate } from "./copy";
import type { BlogPost } from "./types";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  results: BlogPost[];
  basePath: string;
}

/**
 * In-site search.
 *
 * A reader arrives at a site to find something, so the site has to be
 * searchable — but only over what this site has published. In the prototype the
 * matching runs in the browser over the loaded entries; the real one is a site
 * index built at publish time, never the knowledge base's.
 */
const BlogSearch = ({ query, onQueryChange, results, basePath }: Props) => (
  <div className="blog-shell pt-14">
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="blog-section-title">{COPY.searchTitle}</h1>
      <div className="mt-8 flex items-center gap-3 rounded-full border border-[color:var(--blog-hairline)] px-5 focus-within:border-[color:var(--blog-accent)]">
        <SearchIcon className="h-5 w-5 shrink-0 text-[color:var(--blog-ink-muted)]" strokeWidth={1.75} />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={COPY.searchPlaceholder}
          aria-label={COPY.searchPlaceholder}
          className="h-14 w-full bg-transparent text-lg outline-none placeholder:text-[color:var(--blog-ink-muted)]"
        />
      </div>

      <div className="mt-10">
        {query.trim() === "" ? (
          <p className="blog-muted text-base">{COPY.searchPrompt}</p>
        ) : results.length === 0 ? (
          <p className="blog-muted text-base">{COPY.searchNoResults(query)}</p>
        ) : (
          <>
            <p className="blog-muted mb-8 text-sm">{COPY.searchCount(results.length)}</p>
            {results.map((post, index) => (
              <div key={post.slug}>
                {index > 0 && <hr className="blog-rule my-8" />}
                <Link to={blogPostPath(basePath, post.slug)} className="blog-link-quiet block">
                  <h2 className="blog-display blog-underline text-xl leading-snug">{post.title}</h2>
                  {post.summary && <p className="blog-muted mt-2 text-[0.9375rem] leading-relaxed">{post.summary}</p>}
                  <div className="blog-muted mt-3 flex flex-wrap items-center gap-x-3 text-sm">
                    {post.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                    {post.updatedAt && <span>{formatBlogDate(post.updatedAt)}</span>}
                  </div>
                </Link>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  </div>
);

export default BlogSearch;
