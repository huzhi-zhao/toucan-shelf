/**
 * The view models the blog skin renders.
 *
 * Deliberately plain: not `Memo` (the knowledge base's document) and not
 * `PublicPage` (the wire type). The skin is a presentation layer, so the same
 * components render a live site, a preview, or a fixture without knowing which
 * — and wiring the real data in later is one adapter function, not a rewrite.
 */

export interface BlogPost {
  slug: string;
  title: string;
  /** One-line lead shown under the title in list views. */
  summary?: string;
  tags: string[];
  /** Cover image URL. Absent means the entry renders without an image well. */
  coverUrl?: string;
  /** "Last updated" — the only date the site shows (requirements §4). */
  updatedAt?: Date;
  /** Attribution line, e.g. the site's own name. Never a user account. */
  byline?: string;
  /** Markdown body. Only present for a single page, never in a listing. */
  content?: string;
}

/**
 * One node of the site's authored navigation tree.
 *
 * The tree is written by the author in the site's configuration, not derived
 * from where the documents live in the knowledge base — publishing paths and
 * authoring paths are decoupled (requirements §4), and once a site aggregates
 * several knowledge bases there is no single source folder structure to derive
 * from anyway.
 *
 * A node either points at a page (`slug`) or groups other nodes, or both.
 */
export interface BlogNavNode {
  label: string;
  slug?: string;
  children?: BlogNavNode[];
}

/** One entry in the site's top menu. */
export interface BlogMenuItem {
  label: string;
  /** Path relative to the site root, e.g. "" for the home page or "catalog". */
  to: string;
}

/** Everything the shell needs to draw a site's chrome. */
export interface BlogSiteChrome {
  name: string;
  description?: string;
  menu: BlogMenuItem[];
  /** Whether the header offers the search entry point. */
  showSearch: boolean;
}

/* ---------------------------------------------------------------------------
   Home page composition.

   The home page is a list of blocks the author arranges, the same idea as a
   VIEW document in the knowledge base — a heading, a card wall, a list — except
   that out here every block draws from one source only: this site's published
   pages. There is no folder rule and no property rule, because a published page
   has neither; tags are the only grouping a snapshot carries.
   --------------------------------------------------------------------------- */

/** Author-written text: a section heading, an intro, a note between sections. */
export interface BlogMarkdownBlock {
  type: "markdown";
  content: string;
}

/** A card wall. Wide cards, meant for a handful of featured pages. */
export interface BlogGalleryBlock {
  type: "gallery";
  /** Only pages carrying every one of these tags. Empty means the whole site. */
  tags: string[];
  /** `manual` follows `slugs`; `updated_desc` is the only automatic order. */
  sort: "manual" | "updated_desc";
  /** The order used when `sort` is "manual". */
  slugs?: string[];
  limit?: number;
  columns: 2 | 3 | 4;
}

/** A vertical list with an optional topic filter in the left rail. */
export interface BlogFeedBlock {
  type: "feed";
  title: string;
  /** Restricts the whole block. The reader's topic filter narrows within it. */
  tags: string[];
  showTopicFilter: boolean;
  limit?: number;
}

export type BlogBlock = BlogMarkdownBlock | BlogGalleryBlock | BlogFeedBlock;

/** The pages a gallery or feed block covers, in the order it wants them. */
export function selectPosts(posts: BlogPost[], block: BlogGalleryBlock | BlogFeedBlock): BlogPost[] {
  const matching = posts.filter((post) => block.tags.every((tag) => post.tags.includes(tag)));
  const ordered =
    block.type === "gallery" && block.sort === "manual" && block.slugs
      ? block.slugs.map((slug) => matching.find((post) => post.slug === slug)).filter((post): post is BlogPost => post !== undefined)
      : [...matching].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return block.limit ? ordered.slice(0, block.limit) : ordered;
}
