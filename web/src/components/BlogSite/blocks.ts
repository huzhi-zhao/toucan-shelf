/**
 * Parsing the home page's composition out of a published `.view` snapshot.
 *
 * The site's home page is a `.view` document published like any other page, so
 * what arrives here is its snapshot content: the same block JSON the in-app
 * editor writes. Only the outward-facing block types are read; a gallery or
 * calendar block belongs to the knowledge base — its rules (folders, frontmatter
 * properties) have no meaning in a snapshot, and running them out here would
 * mean querying documents rather than publications.
 *
 * Every branch falls back rather than throwing. A site's home page is its front
 * door: one field written wrong must cost that one block, never the page.
 */

import type { BlogBlock, BlogFeedBlock, BlogGalleryBlock, BlogMarkdownBlock } from "./types";

/** Stored type tags. Prefixed, because they sit next to the in-app block types. */
const GALLERY_TYPE = "public_gallery";
const FEED_TYPE = "public_feed";

export const DEFAULT_PUBLIC_GALLERY: BlogGalleryBlock = {
  type: "gallery",
  tags: [],
  sort: "updated_desc",
  columns: 3,
};

export const DEFAULT_PUBLIC_FEED: BlogFeedBlock = {
  type: "feed",
  title: "Latest",
  tags: [],
  showTopicFilter: true,
};

const stringList = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];

// A limit is optional: absent means "everything the block covers". Only a
// positive whole number is a limit; anything else reads as absent.
const positiveInt = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;

const columnsOf = (raw: unknown): BlogGalleryBlock["columns"] => (raw === 2 || raw === 4 ? raw : 3);

function parseGallery(raw: Record<string, unknown>): BlogGalleryBlock {
  const slugs = stringList(raw.slugs);
  const sort = raw.sort === "manual" ? "manual" : "updated_desc";
  return {
    ...DEFAULT_PUBLIC_GALLERY,
    tags: stringList(raw.tags),
    // A manual order with nothing in it would render an empty block; falling
    // back to the automatic order shows the section instead of a blank.
    sort: sort === "manual" && slugs.length > 0 ? "manual" : "updated_desc",
    ...(slugs.length > 0 ? { slugs } : {}),
    limit: positiveInt(raw.limit),
    columns: columnsOf(raw.columns),
  };
}

function parseFeed(raw: Record<string, unknown>): BlogFeedBlock {
  return {
    ...DEFAULT_PUBLIC_FEED,
    title: typeof raw.title === "string" ? raw.title : DEFAULT_PUBLIC_FEED.title,
    tags: stringList(raw.tags),
    showTopicFilter: raw.showTopicFilter !== false,
    limit: positiveInt(raw.limit),
  };
}

// An in-app markdown block may instead reference a knowledge base document
// (`docName`). That document is not part of the snapshot — publishing froze this
// document, not the one it points at — so the block is dropped rather than
// resolved out here.
function parseMarkdown(raw: Record<string, unknown>): BlogMarkdownBlock | undefined {
  if (typeof raw.docName === "string" && raw.docName.trim()) return undefined;
  const content = typeof raw.content === "string" ? raw.content : "";
  return content.trim() ? { type: "markdown", content } : undefined;
}

function parseBlock(raw: unknown): BlogBlock | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const block = raw as Record<string, unknown>;
  if (block.type === "markdown") return parseMarkdown(block);
  if (block.type === GALLERY_TYPE) return parseGallery(block);
  if (block.type === FEED_TYPE) return parseFeed(block);
  // Any other type — a gallery or calendar block, or one added after this code
  // was written — is not ours to render.
  return undefined;
}

/**
 * The blocks a published `.view` snapshot composes the home page from.
 *
 * Returns an empty list for anything that is not a parseable view document,
 * which is the caller's signal to fall back to the plain feed: a site whose home
 * page will not parse still has pages to show.
 */
export function parseBlogBlocks(content: string): BlogBlock[] {
  const body = stripFrontmatter(content);
  if (!body.trimStart().startsWith("{")) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map(parseBlock).filter((block): block is BlogBlock => block !== undefined);
}

/**
 * Drops a leading YAML frontmatter block.
 *
 * The publish pipeline already strips frontmatter from snapshots; this is here
 * for snapshots taken before it did, and it is four lines rather than an import
 * from the app's parser — the outward component tree deliberately shares no code
 * with the knowledge base's.
 */
function stripFrontmatter(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") return content;
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  return close === -1 ? content : lines.slice(close + 1).join("\n");
}
