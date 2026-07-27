import { parseViewBlock, splitViewContent, stripFrontmatterFences, type ViewBlock } from "./types";

// The Home document is a single per-user VIEW document that works like an
// ordinary view with two differences: its blocks may scan any knowledge base
// (see `GalleryScope.workspaces`), and its blocks are grouped into named
// sections rendered as tabs. Sections are a pure UI grouping — each is a list
// of the same `ViewBlock`s a normal view holds, so every block renderer and the
// block editor are reused unchanged.

/** One tab of the Home page. */
export interface HomeSection {
  /** Stable id, used in the URL (`/dashboard/:sectionId`) and as the React key. */
  id: string;
  title: string;
  blocks: ViewBlock[];
}

export interface HomeViewConfig {
  viewType: "home";
  sections: HomeSection[];
  /** Raw YAML frontmatter (inner text, no `---` delimiters), as for gallery views. */
  frontmatter?: string;
}

export const DEFAULT_SECTION_ID = "default";

export function newSectionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptySection(title: string, id = newSectionId()): HomeSection {
  return { id, title, blocks: [] };
}

/** A Home config with one empty section, used for a freshly created Home document. */
export function emptyHomeConfig(defaultTitle: string): HomeViewConfig {
  return { viewType: "home", sections: [emptySection(defaultTitle, DEFAULT_SECTION_ID)] };
}

function parseSection(raw: unknown, index: number, defaultTitle: string): HomeSection {
  const s = (raw ?? {}) as { id?: unknown; title?: unknown; blocks?: unknown };
  const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `${DEFAULT_SECTION_ID}${index || ""}`;
  const title = typeof s.title === "string" && s.title.trim() ? s.title : defaultTitle;
  const blocks = Array.isArray(s.blocks) ? s.blocks.flatMap(parseViewBlock) : [];
  return { id, title, blocks };
}

/**
 * Parses the Home document's content. A document written before sections
 * existed — or a plain gallery view promoted to Home — carries a top-level
 * `blocks` array instead, and is read as a single default section. Returns
 * undefined only when there is no parseable config at all, so the caller can
 * fall back to an empty Home.
 */
export function parseHomeViewConfig(content: string, defaultTitle: string): HomeViewConfig | undefined {
  const split = splitViewContent(content);
  if (!split) return undefined;
  const { frontmatter, raw } = split;
  const fm = frontmatter.trim() ? frontmatter : undefined;
  if (Array.isArray(raw.sections)) {
    const sections = raw.sections.map((s, i) => parseSection(s, i, defaultTitle));
    // A Home page always has at least one tab: an empty `sections` array would
    // otherwise leave the page with nothing to select or edit.
    return {
      viewType: "home",
      sections: sections.length > 0 ? sections : [emptySection(defaultTitle, DEFAULT_SECTION_ID)],
      frontmatter: fm,
    };
  }
  if (Array.isArray(raw.blocks)) {
    const blocks = raw.blocks.flatMap(parseViewBlock);
    return { viewType: "home", sections: [{ id: DEFAULT_SECTION_ID, title: defaultTitle, blocks }], frontmatter: fm };
  }
  return undefined;
}

export function serializeHomeViewConfig(config: HomeViewConfig): string {
  const json = JSON.stringify({ viewType: "home", sections: config.sections }, null, 2);
  const fm = stripFrontmatterFences(config.frontmatter ?? "");
  return fm ? `---\n${fm}\n---\n${json}` : json;
}
