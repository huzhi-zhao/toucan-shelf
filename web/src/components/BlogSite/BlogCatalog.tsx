import { Link } from "react-router-dom";
import { blogPostPath } from "./adapt";
import { COPY, formatBlogDate } from "./copy";
import type { BlogNavNode, BlogPost } from "./types";

/** Every slug a node covers, itself first, then its descendants in order. */
const slugsUnder = (node: BlogNavNode): string[] => [...(node.slug ? [node.slug] : []), ...(node.children ?? []).flatMap(slugsUnder)];

const NavTree = ({
  nodes,
  path,
  selectedKey,
  onSelect,
  depth = 0,
}: {
  nodes: BlogNavNode[];
  path: string;
  selectedKey: string;
  onSelect: (key: string) => void;
  depth?: number;
}) => (
  <ul className={depth === 0 ? "flex flex-col gap-6" : "mt-1 flex flex-col border-l border-[color:var(--blog-hairline)]"}>
    {nodes.map((node, index) => {
      const key = path ? `${path}.${index}` : `${index}`;
      const selected = key === selectedKey;
      return (
        <li key={key}>
          <button
            type="button"
            onClick={() => onSelect(key)}
            className={
              depth === 0
                ? `blog-display block w-full text-left text-[0.9375rem] ${selected ? "text-[color:var(--blog-accent)]" : ""}`
                : `-ml-px block w-full border-l-2 py-1.5 pl-4 text-left text-[0.9375rem] transition-colors ${
                    selected
                      ? "border-[color:var(--blog-accent)] text-[color:var(--blog-accent)]"
                      : "border-transparent text-[color:var(--blog-ink-soft)] hover:text-[color:var(--blog-ink)]"
                  }`
            }
          >
            {node.label}
          </button>
          {node.children && node.children.length > 0 && (
            <NavTree nodes={node.children} path={key} selectedKey={selectedKey} onSelect={onSelect} depth={depth + 1} />
          )}
        </li>
      );
    })}
  </ul>
);

interface Props {
  nav: BlogNavNode[];
  posts: BlogPost[];
  selectedKey: string;
  onSelect: (key: string) => void;
  basePath: string;
}

/** Resolves a tree key ("1.0") back to the node it addresses. */
const nodeAt = (nav: BlogNavNode[], key: string): BlogNavNode | undefined => {
  if (!key) return undefined;
  return key.split(".").reduce<BlogNavNode | undefined>((node, part) => {
    const list = node ? (node.children ?? []) : nav;
    return list[Number(part)];
  }, undefined);
};

/**
 * The catalog: the site's authored navigation tree on the left, the pages the
 * selected branch covers on the right.
 *
 * The tree is written by the author in the site's configuration — it is not
 * derived from the source documents' folders. The URLs stay flat (`/<slug>`)
 * whatever the tree says; hierarchy here is navigation, not addressing.
 */
const BlogCatalog = ({ nav, posts, selectedKey, onSelect, basePath }: Props) => {
  const selected = nodeAt(nav, selectedKey);
  const scope = selected ? slugsUnder(selected) : nav.flatMap(slugsUnder);
  const bySlug = new Map(posts.map((post) => [post.slug, post]));
  const listed = scope.map((slug) => bySlug.get(slug)).filter((post): post is BlogPost => post !== undefined);

  return (
    <div className="blog-shell grid gap-y-10 pt-14 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-x-[clamp(2.5rem,6vw,6rem)]">
      <nav aria-label={COPY.catalogNavLabel} className="lg:sticky lg:top-28 lg:self-start">
        <p className="blog-muted mb-5 text-sm">{COPY.catalogNavLabel}</p>
        <NavTree nodes={nav} path="" selectedKey={selectedKey} onSelect={onSelect} />
      </nav>

      <div className="min-w-0">
        <h1 className="blog-section-title">{selected?.label ?? COPY.catalogAllPosts}</h1>
        <div className="mt-10">
          {listed.length === 0 ? (
            <p className="blog-muted text-base">{COPY.catalogEmpty}</p>
          ) : (
            listed.map((post, index) => (
              <div key={post.slug}>
                {index > 0 && <hr className="blog-rule my-8" />}
                <Link to={blogPostPath(basePath, post.slug)} className="blog-link-quiet block">
                  <h2 className="blog-display blog-underline text-xl leading-snug">{post.title}</h2>
                  {post.summary && <p className="blog-muted mt-2 text-[0.9375rem] leading-relaxed">{post.summary}</p>}
                  {post.updatedAt && (
                    <p className="blog-muted mt-3 text-sm">
                      {COPY.lastUpdated} {formatBlogDate(post.updatedAt)}
                    </p>
                  )}
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default BlogCatalog;
