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
  /**
   * Which knowledge bases the block scans, as `workspaces/{uid}` resource names.
   * Omitted (the only thing an ordinary VIEW document ever stores) means "the
   * view document's own workspace". `[ALL_WORKSPACES]` means every workspace the
   * viewer can see. Only the Home document's editor exposes this.
   */
  workspaces?: string[];
}

/** Sentinel inside `GalleryScope.workspaces` meaning "every visible workspace". */
export const ALL_WORKSPACES = "*";

/**
 * Turns a scope's workspace selection into the two things a block needs to run
 * its query: the server-side `ListMemos` filter, and — when the selection can't
 * be expressed as a single equality — the set of workspaces to keep client-side.
 *
 * The memo filter grammar only allows `==`/`!=` on `workspace`, so a multi-base
 * selection is fetched unfiltered and narrowed in the browser, the same way the
 * scope's own rules already are.
 */
export function resolveScopeWorkspaces(scope: GalleryScope, ownWorkspace: string): { filter?: string; allowed?: ReadonlySet<string> } {
  const selected = (scope.workspaces ?? []).filter((w) => w.trim() !== "");
  if (selected.length === 0) return { filter: `workspace == ${JSON.stringify(ownWorkspace)}` };
  if (selected.includes(ALL_WORKSPACES)) return {};
  if (selected.length === 1) return { filter: `workspace == ${JSON.stringify(selected[0])}` };
  return { allowed: new Set(selected) };
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
 * A calendar layout block within a VIEW document. Like a gallery block it scans
 * documents live via `scope` — no calendar→document mapping is ever persisted;
 * the matched documents are bucketed onto a month grid by date each render.
 *
 * A document's date comes from the frontmatter property named by `dateProperty`
 * (a `YYYY-MM-DD` string). When `dateProperty` is empty the block falls back to
 * a `date` property if present, otherwise the document's creation date — so a
 * document created through the calendar's add button (which always writes a
 * `date` property) still lands on the chosen day.
 */
export interface CalendarLayoutBlock {
  type: "calendar";
  scope: GalleryScope;
  /** Frontmatter property key holding the doc's date. Empty = creation date. */
  dateProperty: string;
  /** Field shown as a tile card's label. Defaults to the document title. */
  cardField: GalleryCardField;
  /**
   * Folder (relative to the knowledge base root) new documents are created in
   * from the add button. When empty, the doc is created in the scope's first
   * folder rule, or the view's own folder — so setting this pins the location
   * explicitly instead of relying on that fallback.
   */
  newDocFolder: string;
}

/**
 * A markdown block within a VIEW document. Rendered by the same markdown
 * pipeline as any other document, so every block type it supports (grid,
 * calendar, kanban, sheets, …) works here too.
 *
 * Two sources: inline markdown typed into the view (`content`, editable in
 * place), or a reference to an existing knowledge-base document (`docName`, a
 * `memos/<uid>` resource name). A referenced document is rendered read-only —
 * its content lives in that document and is edited there, not here — and
 * `content` is unused.
 */
export interface MarkdownBlock {
  type: "markdown";
  content: string;
  /** When set, render this document's content instead of `content`. */
  docName?: string;
}

/** Blocks are heterogeneous and render top-to-bottom in list order. */
export type ViewBlock = GalleryBlock | MarkdownBlock | CalendarLayoutBlock;

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

export const DEFAULT_CALENDAR_LAYOUT_BLOCK: CalendarLayoutBlock = {
  type: "calendar",
  scope: { match: "all", groups: [{ match: "all", rules: [{ kind: "folder" }] }] },
  dateProperty: "",
  cardField: "__title__",
  newDocFolder: "",
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
function migrateLegacyScope(raw: {
  type?: unknown;
  path?: unknown;
  includeSubfolders?: unknown;
  tag?: unknown;
  filters?: unknown;
}): GalleryScope | undefined {
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
    return {
      match: "all",
      groups: [{ match: "all", rules: filters.map((f) => ({ kind: "property" as const, key: f.key, value: f.value })) }],
    };
  }
  if (raw.type === "folder") {
    const includeSubfolders = raw.includeSubfolders === false ? false : true;
    const path = typeof raw.path === "string" && raw.path.trim() ? raw.path.trim() : undefined;
    return { match: "all", groups: [{ match: "all", rules: [{ kind: "folder", path, includeSubfolders }] }] };
  }
  return undefined;
}

// Keeps only non-empty strings, and returns undefined for an empty selection so
// the field stays absent from documents that never set it.
function parseWorkspaces(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter((w): w is string => typeof w === "string" && w.trim() !== "").map((w) => w.trim());
  return list.length > 0 ? Array.from(new Set(list)) : undefined;
}

function parseScope(raw: unknown): GalleryScope {
  if (raw && typeof raw === "object") {
    const scope = raw as { groups?: unknown; match?: unknown; type?: unknown; workspaces?: unknown };
    if (Array.isArray(scope.groups)) {
      const workspaces = parseWorkspaces(scope.workspaces);
      return { match: parseMatch(scope.match), groups: scope.groups.map(parseGroup), ...(workspaces ? { workspaces } : {}) };
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

function parseCalendarLayoutBlock(raw: unknown): CalendarLayoutBlock {
  const b = (raw ?? {}) as { scope?: unknown; dateProperty?: unknown; cardField?: unknown; newDocFolder?: unknown };
  return {
    type: "calendar",
    scope: parseScope(b.scope),
    dateProperty: typeof b.dateProperty === "string" ? b.dateProperty.trim() : "",
    cardField: normalizeCardField(b.cardField, "__title__"),
    newDocFolder: typeof b.newDocFolder === "string" ? b.newDocFolder.trim() : "",
  };
}

// A markdown block is kept when it has either inline content or a document
// reference; an empty one carries nothing to render and is dropped.
function parseMarkdownBlock(raw: unknown): MarkdownBlock | undefined {
  const b = (raw ?? {}) as { content?: unknown; docName?: unknown };
  const docName = typeof b.docName === "string" && b.docName.trim() ? b.docName.trim() : undefined;
  const content = typeof b.content === "string" ? b.content : "";
  if (docName) return { type: "markdown", content, docName };
  return content.trim() ? { type: "markdown", content } : undefined;
}

/** Parses one stored block. */
export function parseViewBlock(raw: unknown): ViewBlock[] {
  const b = (raw ?? {}) as { type?: unknown };
  if (b.type === "markdown") {
    const block = parseMarkdownBlock(raw);
    return block ? [block] : [];
  }
  if (b.type === "calendar") return [parseCalendarLayoutBlock(raw)];
  return [parseGalleryBlock(raw)];
}

/**
 * Parses a VIEW document's content into gallery blocks. Returns undefined when
 * the content isn't a gallery view at all (empty/invalid), so the editor can
 * show its empty state. Legacy single-block documents (config fields at the top
 * level, no `blocks` array) are migrated into a one-element block list.
 */
/**
 * Splits a VIEW document's content into its YAML frontmatter and the parsed
 * config JSON. Returns undefined when there is no parseable JSON body.
 */
export function splitViewContent(content: string): { frontmatter: string; raw: Record<string, unknown> } | undefined {
  if (!content.trim()) return undefined;
  // The config JSON lives in the body, after any leading YAML frontmatter block.
  let { frontmatter, body } = splitFrontmatter(content);
  // Salvage documents saved before serialization stripped author-typed `---`
  // fences: their doubled fences make splitFrontmatter stop at the wrong one and
  // leave the config JSON stranded in the frontmatter, which used to render the
  // whole view blank. The JSON always starts at the beginning of a line, so
  // re-split there and treat everything before it as frontmatter.
  if (!body.trimStart().startsWith("{")) {
    const jsonStart = content.indexOf("\n{");
    if (jsonStart >= 0) {
      body = content.slice(jsonStart + 1);
      frontmatter = stripFrontmatterFences(content.slice(0, jsonStart));
    }
  }
  if (!body.trim()) return undefined;
  try {
    const raw = JSON.parse(body);
    if (!raw || typeof raw !== "object") return undefined;
    return { frontmatter, raw };
  } catch {
    return undefined;
  }
}

export function parseGalleryViewConfig(content: string): GalleryViewConfig | undefined {
  const split = splitViewContent(content);
  if (!split) return undefined;
  const { frontmatter, raw } = split;
  if (raw.viewType !== "gallery") return undefined;
  // Legacy single-config shape (no `blocks` array): treat the whole object as one block.
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [raw]).flatMap(parseViewBlock);
  return { viewType: "gallery", blocks, frontmatter: frontmatter.trim() ? frontmatter : undefined };
}

/**
 * Strips `---` fences the author typed around their own frontmatter. The editor
 * asks for the inner YAML only and adds the delimiters itself, but typing them
 * is the natural thing to do — and without this the document would serialize
 * with two nested fences, whereupon splitFrontmatter stops at the inner one and
 * the config JSON lands inside the frontmatter, making the whole view unparseable.
 */
export function stripFrontmatterFences(frontmatter: string): string {
  const lines = frontmatter.split("\n");
  while (lines.length > 0 && lines[0].trim() === "---") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "---") lines.pop();
  return lines.join("\n").trim();
}

export function serializeGalleryViewConfig(config: GalleryViewConfig): string {
  const json = JSON.stringify({ viewType: config.viewType, blocks: config.blocks }, null, 2);
  const fm = stripFrontmatterFences(config.frontmatter ?? "");
  return fm ? `---\n${fm}\n---\n${json}` : json;
}
