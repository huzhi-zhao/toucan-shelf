import { splitFrontmatter } from "@/utils/frontmatter";

// Structured configuration stored as the content of a VIEW document.
// The content holds ONLY this JSON (plus optional markdown intro fields inside
// it) — never HTML or rendered output. Every view block is rendered live from
// current data each time the document is opened.
//
// A single VIEW document may hold multiple gallery blocks (each with its own
// intro, scope, sort, cover and card fields), rendered top-to-bottom separated
// by dividers.

/**
 * One matching condition within a scope group. `folder` matches documents in
 * a folder (defaulting to the view doc's own folder when `path` is omitted);
 * by default it also matches subfolders, unless `includeSubfolders` is false.
 * `tag` matches documents carrying that tag. `property` matches documents
 * whose frontmatter property `key` equals `value` (for list properties, when
 * any item equals `value`).
 */
export type GalleryRule =
  | { kind: "folder"; path?: string; includeSubfolders?: boolean }
  | { kind: "tag"; tag: string }
  | { kind: "property"; key: string; value: string };

export type GalleryMatch = "all" | "any";

/** A group of rules, combined with `match` ("all" = AND, "any" = OR). */
export interface GalleryGroup {
  match: GalleryMatch;
  rules: GalleryRule[];
}

// Which documents a gallery block shows: groups of rules, themselves combined
// with `match`. Two levels only (group match, rule match within a group) —
// e.g. `match: "any"` over groups `[{match: "all", rules: [A, B]}, {match: "all", rules: [C]}]`
// expresses `(A AND B) OR C`.
export interface GalleryScope {
  match: GalleryMatch;
  groups: GalleryGroup[];
}

export type GalleryBuiltinSort = "updated_desc" | "updated_asc" | "created_desc" | "created_asc" | "title_asc";

/**
 * How a gallery block orders its cards. Either a built-in token, or a sort by a
 * frontmatter property encoded as `prop_asc:<key>` / `prop_desc:<key>`. Documents
 * missing the property sort to the end.
 */
export type GallerySort = GalleryBuiltinSort | (string & {});

/**
 * How a gallery card's cover image is chosen. `first_image` uses the document's
 * first image attachment (or first inline markdown image); `none` shows no cover;
 * `prop:<key>` uses a frontmatter property value as the image source (an
 * `attachments/...` resource name is resolved to the attachment, anything else is
 * used as a URL).
 */
export type GalleryCoverRule = "first_image" | "none" | (string & {});

/**
 * A field shown on a gallery card. Built-in tokens cover the document's own
 * metadata; `prop:<key>` pulls a frontmatter property value. Empty string means
 * "show nothing" for that row.
 */
export type GalleryCardField = "__title__" | "__updated__" | "__created__" | "" | (string & {});

export interface GalleryCardFields {
  /** First (bold) row. Defaults to the document title. */
  primary: GalleryCardField;
  /** Second (muted) row. Defaults to the update date. */
  secondary: GalleryCardField;
}

/**
 * Which ribbon style a card badge uses. `tag` is a top-left flag/pennant
 * shape and additionally dims the card (grayscale + reduced opacity) to
 * de-emphasize it — meant for "completed" style badges. `ribbon` is a
 * vertical folded ribbon in the top-left corner. `corner` is a diagonal
 * ribbon across the top-right corner. Neither `ribbon` nor `corner` carry
 * any special behavior beyond display.
 */
export type GalleryBadgeKind = "tag" | "ribbon" | "corner";

/**
 * One badge configured on a gallery block. Applies to any card whose
 * document has a frontmatter property `propertyKey` equal to `propertyValue`
 * (a `property` scope filter, same equality semantics as `GalleryRule`'s
 * `property` kind). A block may configure at most 3 badges; the first whose
 * filter matches a given card wins.
 */
export interface GalleryBadgeRule {
  kind: GalleryBadgeKind;
  /** Badge label text, at most 5 characters. */
  title: string;
  /** Badge color (CSS hex color string). */
  color: string;
  /** Frontmatter property key this badge's filter checks. */
  propertyKey: string;
  /** Value `propertyKey` must equal for a card to receive this badge. */
  propertyValue: string;
}

export const MAX_GALLERY_BADGES = 3;

/** A single gallery within a VIEW document. */
export interface GalleryBlock {
  type: "gallery";
  scope: GalleryScope;
  sort: GallerySort;
  cover: GalleryCoverRule;
  cardFields: GalleryCardFields;
  /** At most `MAX_GALLERY_BADGES` badge rules. */
  badges: GalleryBadgeRule[];
}

/**
 * A free markdown block within a VIEW document. Rendered by the same markdown
 * pipeline as any other document, so every block type it supports (grid,
 * calendar, kanban, sheets, …) works here too, editing included.
 */
export interface MarkdownBlock {
  type: "markdown";
  content: string;
}

/** Blocks are heterogeneous and render top-to-bottom in list order. */
export type ViewBlock = GalleryBlock | MarkdownBlock;

export interface GalleryViewConfig {
  viewType: "gallery";
  blocks: ViewBlock[];
  /**
   * Raw YAML frontmatter (inner text, no `---` delimiters) stored ahead of the
   * config JSON in the document content. Gives VIEW documents their own
   * properties, so a gallery can filter/sort/reference them like any other doc.
   */
  frontmatter?: string;
}

export const DEFAULT_CARD_FIELDS: GalleryCardFields = {
  primary: "__title__",
  secondary: "__updated__",
};

export const DEFAULT_GALLERY_BLOCK: GalleryBlock = {
  type: "gallery",
  scope: { match: "all", groups: [{ match: "all", rules: [{ kind: "folder" }] }] },
  sort: "updated_desc",
  cover: "first_image",
  cardFields: DEFAULT_CARD_FIELDS,
  badges: [],
};

function parseMatch(raw: unknown): GalleryMatch {
  return raw === "any" ? "any" : "all";
}

function parseRule(raw: unknown): GalleryRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { kind?: unknown; path?: unknown; includeSubfolders?: unknown; tag?: unknown; key?: unknown; value?: unknown };
  if (r.kind === "tag" && typeof r.tag === "string") return { kind: "tag", tag: r.tag };
  if (r.kind === "property") return { kind: "property", key: String(r.key ?? ""), value: String(r.value ?? "") };
  if (r.kind === "folder") {
    const includeSubfolders = r.includeSubfolders === false ? false : true;
    const path = typeof r.path === "string" && r.path.trim() ? r.path.trim() : undefined;
    return { kind: "folder", path, includeSubfolders };
  }
  return undefined;
}

function parseGroup(raw: unknown): GalleryGroup {
  if (!raw || typeof raw !== "object") return { match: "all", rules: [] };
  const g = raw as { match?: unknown; rules?: unknown };
  const rules = Array.isArray(g.rules) ? g.rules.map(parseRule).filter((r): r is GalleryRule => r !== undefined) : [];
  return { match: parseMatch(g.match), rules };
}

// Migrates the pre-group scope shape (a single folder/tag/property selector)
// into a one-group, one-rule scope.
function migrateLegacyScope(raw: { type?: unknown; path?: unknown; includeSubfolders?: unknown; tag?: unknown; filters?: unknown }):
  | GalleryScope
  | undefined {
  if (raw.type === "tag" && typeof raw.tag === "string") {
    return { match: "all", groups: [{ match: "all", rules: [{ kind: "tag", tag: raw.tag }] }] };
  }
  if (raw.type === "property") {
    const filters = Array.isArray(raw.filters)
      ? raw.filters
          .filter((f: unknown): f is { key: unknown; value: unknown } => !!f && typeof f === "object")
          .map((f: { key: unknown; value: unknown }) => ({ key: String(f.key ?? "").trim(), value: String(f.value ?? "") }))
          .filter((f: { key: string; value: string }) => f.key !== "")
      : [];
    return { match: "all", groups: [{ match: "all", rules: filters.map((f) => ({ kind: "property" as const, key: f.key, value: f.value })) }] };
  }
  if (raw.type === "folder") {
    const includeSubfolders = raw.includeSubfolders === false ? false : true;
    const path = typeof raw.path === "string" && raw.path.trim() ? raw.path.trim() : undefined;
    return { match: "all", groups: [{ match: "all", rules: [{ kind: "folder", path, includeSubfolders }] }] };
  }
  return undefined;
}

function parseScope(raw: unknown): GalleryScope {
  if (raw && typeof raw === "object") {
    const scope = raw as { groups?: unknown; match?: unknown; type?: unknown };
    if (Array.isArray(scope.groups)) {
      return { match: parseMatch(scope.match), groups: scope.groups.map(parseGroup) };
    }
    const legacy = migrateLegacyScope(scope);
    if (legacy) return legacy;
  }
  return DEFAULT_GALLERY_BLOCK.scope;
}

const CARD_FIELD_TOKENS = new Set(["__title__", "__updated__", "__created__"]);

// Sanitize a stored card field: keep known tokens, empty string, or a
// `prop:<key>` reference; fall back to empty otherwise.
function normalizeCardField(raw: unknown, fallback: GalleryCardField): GalleryCardField {
  if (raw === "") return "";
  if (typeof raw !== "string") return fallback;
  if (CARD_FIELD_TOKENS.has(raw) || raw.startsWith("prop:")) return raw;
  return fallback;
}

const BUILTIN_SORTS: GalleryBuiltinSort[] = ["updated_desc", "updated_asc", "created_desc", "created_asc", "title_asc"];

// True for the `prop_asc:<key>` / `prop_desc:<key>` property-sort encoding.
const PROP_SORT_RE = /^prop_(asc|desc):/;

function normalizeSort(raw: unknown): GallerySort {
  if (typeof raw === "string") {
    if ((BUILTIN_SORTS as string[]).includes(raw)) return raw as GallerySort;
    if (PROP_SORT_RE.test(raw)) return raw;
  }
  return DEFAULT_GALLERY_BLOCK.sort;
}

function normalizeCover(raw: unknown): GalleryCoverRule {
  if (raw === "none") return "none";
  if (typeof raw === "string" && raw.startsWith("prop:")) return raw;
  return "first_image";
}

const BADGE_KINDS = new Set<GalleryBadgeKind>(["tag", "ribbon", "corner"]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
export const DEFAULT_BADGE_COLOR = "#e63d3d";

function parseBadgeRule(raw: unknown): GalleryBadgeRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { kind?: unknown; title?: unknown; color?: unknown; propertyKey?: unknown; propertyValue?: unknown };
  const kind = typeof r.kind === "string" && BADGE_KINDS.has(r.kind as GalleryBadgeKind) ? (r.kind as GalleryBadgeKind) : undefined;
  if (!kind) return undefined;
  const title = typeof r.title === "string" ? r.title.slice(0, 5) : "";
  const color = typeof r.color === "string" && HEX_COLOR_RE.test(r.color) ? r.color : DEFAULT_BADGE_COLOR;
  const propertyKey = typeof r.propertyKey === "string" ? r.propertyKey.trim() : "";
  const propertyValue = typeof r.propertyValue === "string" ? r.propertyValue : "";
  return { kind, title, color, propertyKey, propertyValue };
}

function parseBadges(raw: unknown): GalleryBadgeRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseBadgeRule)
    .filter((b): b is GalleryBadgeRule => b !== undefined)
    .slice(0, MAX_GALLERY_BADGES);
}

function parseGalleryBlock(raw: unknown): GalleryBlock {
  const b = (raw ?? {}) as {
    scope?: unknown;
    sort?: unknown;
    cover?: unknown;
    cardFields?: { primary?: unknown; secondary?: unknown };
    badges?: unknown;
  };
  return {
    type: "gallery",
    scope: parseScope(b.scope),
    sort: normalizeSort(b.sort),
    cover: normalizeCover(b.cover),
    cardFields: {
      primary: normalizeCardField(b.cardFields?.primary, DEFAULT_CARD_FIELDS.primary),
      secondary: normalizeCardField(b.cardFields?.secondary, DEFAULT_CARD_FIELDS.secondary),
    },
    badges: parseBadges(b.badges),
  };
}

/**
 * Resolves the badge (if any) a document should show within a block: the
 * first configured badge whose property filter matches the document's
 * frontmatter properties. A badge with an empty `propertyKey` never matches
 * (a badge always needs its own filter).
 */
export function matchGalleryBadge(
  badges: GalleryBadgeRule[],
  props: { get(key: string): { value: unknown; type: string } | undefined },
): GalleryBadgeRule | undefined {
  return badges.find((badge) => {
    if (!badge.propertyKey) return false;
    const prop = props.get(badge.propertyKey);
    if (!prop) return false;
    if (prop.type === "list") return Array.isArray(prop.value) && prop.value.some((v) => v === badge.propertyValue);
    return String(prop.value ?? "") === badge.propertyValue;
  });
}

function markdownBlock(raw: unknown): MarkdownBlock | undefined {
  return typeof raw === "string" && raw.trim() ? { type: "markdown", content: raw } : undefined;
}

/**
 * Parses one stored block. Blocks predating the heterogeneous list carried the
 * markdown intro/note as `description`/`footer` fields on the gallery itself;
 * those expand into standalone markdown blocks around it, which is how the old
 * document renders identically under the new structure. Remove this expansion
 * once stored documents have been migrated.
 */
function parseViewBlock(raw: unknown): ViewBlock[] {
  const b = (raw ?? {}) as { type?: unknown; content?: unknown; description?: unknown; footer?: unknown };
  if (b.type === "markdown") {
    const block = markdownBlock(b.content);
    return block ? [block] : [];
  }
  return [markdownBlock(b.description), parseGalleryBlock(raw), markdownBlock(b.footer)].filter(
    (block): block is ViewBlock => block !== undefined,
  );
}

/**
 * Parses a VIEW document's content into gallery blocks. Returns undefined when
 * the content isn't a gallery view at all (empty/invalid), so the editor can
 * show its empty state. Legacy single-block documents (config fields at the top
 * level, no `blocks` array) are migrated into a one-element block list.
 */
export function parseGalleryViewConfig(content: string): GalleryViewConfig | undefined {
  if (!content.trim()) return undefined;
  // The config JSON lives in the body, after any leading YAML frontmatter block.
  const { frontmatter, body } = splitFrontmatter(content);
  if (!body.trim()) return undefined;
  try {
    const raw = JSON.parse(body);
    if (!raw || typeof raw !== "object" || raw.viewType !== "gallery") return undefined;
    // Legacy single-config shape (no `blocks` array): treat the whole object as one block.
    const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [raw]).flatMap(parseViewBlock);
    return { viewType: "gallery", blocks, frontmatter: frontmatter.trim() ? frontmatter : undefined };
  } catch {
    return undefined;
  }
}

export function serializeGalleryViewConfig(config: GalleryViewConfig): string {
  const json = JSON.stringify({ viewType: config.viewType, blocks: config.blocks }, null, 2);
  const fm = config.frontmatter?.trim();
  return fm ? `---\n${fm}\n---\n${json}` : json;
}
