import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { PublicSiteRenderProvider } from "@/components/MemoContent/PublicSiteRenderContext";
import { COPY, formatBlogDate } from "./copy";
import type { BlogPost } from "./types";

/**
 * One published page.
 *
 * The body is rendered by the application's own markdown renderer in its public
 * mode — the blog skin changes the page around the text (measure, type scale,
 * header, footer), not the text itself. Re-implementing the renderer for the
 * site would mean a published page slowly drifting away from the document it
 * was published from.
 */
const BlogArticle = ({ post, basePath }: { post: BlogPost; basePath: string }) => (
  <div className="blog-shell pt-10">
    <div className="mx-auto w-full max-w-[var(--blog-prose-max)]">
      <Link to={basePath || "/"} className="blog-muted inline-flex items-center gap-1.5 text-sm hover:text-[color:var(--blog-ink)]">
        <ArrowLeftIcon className="h-4 w-4" strokeWidth={1.75} />
        {COPY.articleBack}
      </Link>

      <header className="mt-8">
        {post.tags.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="blog-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        <h1 className="blog-article-title">{post.title}</h1>
        {post.summary && <p className="blog-muted mt-5 text-lg leading-relaxed">{post.summary}</p>}
        <div className="blog-muted mt-7 flex flex-wrap items-center gap-x-3 text-[0.9375rem]">
          {post.byline && <span>{post.byline}</span>}
          {post.byline && post.updatedAt && <span aria-hidden>·</span>}
          {post.updatedAt && (
            <span>
              {COPY.lastUpdated} {formatBlogDate(post.updatedAt)}
            </span>
          )}
        </div>
      </header>

      {post.coverUrl && <img src={post.coverUrl} alt="" className="blog-cover mt-10" />}

      <hr className="blog-rule mt-10" />

      <div className="blog-prose mt-10">
        <PublicSiteRenderProvider basePath={basePath}>
          <MemoContent content={post.content ?? ""} density="reading" alwaysExpanded />
        </PublicSiteRenderProvider>
      </div>
    </div>
  </div>
);

export default BlogArticle;
