import { ArrowRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { blogPostPath } from "./adapt";
import { COPY, formatBlogDate } from "./copy";
import type { BlogPost } from "./types";

const COLUMN_CLASS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * One gallery card: image, the page's first tag as an eyebrow, title, lead, and
 * an explicit "read" control.
 *
 * The card is a panel rather than an outlined tile, and the whole card is not
 * one big link — a reader gets a target they can see, which matters more here
 * than the density the knowledge base's card wall optimises for.
 */
const BlogGalleryCard = ({ post, basePath }: { post: BlogPost; basePath: string }) => (
  <article className="blog-card flex flex-col">
    {post.coverUrl && (
      <div className="p-3 pb-0">
        <img src={post.coverUrl} alt="" loading="lazy" className="blog-card-media" />
      </div>
    )}
    <div className="flex grow flex-col p-7">
      {post.tags[0] && <p className="blog-eyebrow">{post.tags[0]}</p>}
      <h3 className="blog-card-title mt-3">
        <Link to={blogPostPath(basePath, post.slug)} className="blog-link-quiet blog-underline">
          {post.title}
        </Link>
      </h3>
      {post.summary && <p className="blog-muted mt-4 text-[0.9375rem] leading-relaxed">{post.summary}</p>}
      <div className="grow" />
      {post.updatedAt && <p className="blog-muted mt-6 text-sm">{formatBlogDate(post.updatedAt)}</p>}
      <Link to={blogPostPath(basePath, post.slug)} className="blog-cta mt-5 self-start" tabIndex={-1} aria-hidden>
        {COPY.galleryCta}
        <ArrowRightIcon className="h-4 w-4" strokeWidth={2} />
      </Link>
    </div>
  </article>
);

/** A gallery block: the pages it covers, laid out as a card wall. */
const BlogGallery = ({ posts, columns, basePath }: { posts: BlogPost[]; columns: number; basePath: string }) => {
  if (posts.length === 0) {
    return <p className="blog-muted text-base">{COPY.galleryEmpty}</p>;
  }
  return (
    <div className={`grid grid-cols-1 gap-6 ${COLUMN_CLASS[columns] ?? COLUMN_CLASS[3]}`}>
      {posts.map((post) => (
        <BlogGalleryCard key={post.slug} post={post} basePath={basePath} />
      ))}
    </div>
  );
};

export default BlogGallery;
