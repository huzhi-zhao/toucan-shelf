// URL references: the external links a document lists in its References section, next to its
// sub-documents. See docs/dev/requirements/knowledge-base/url-references.md.
//
// They live in the document's frontmatter, as a flat list of strings under `references`:
//
//   ---
//   references:
//     - "[Open before changing any budget figure](https://docs.google.com/document/d/abc)"
//     - "https://example.com/rfc-123"
//   ---
//
// Each item is a markdown link whose text is the note — WHEN the link should be opened — or a
// bare URL when there is no note. Keeping them in the content (not the memo payload) is what
// puts them in front of agents on every channel: memogit files and MCP reads carry the
// frontmatter verbatim, so an agent sees the references before it reads a word of the body.
//
// Reading is lenient (indented or flush-left items, quoted or not) and writing is strict (two-space
// indent, every item double-quoted), because agents and people hand-edit this block. What can't be
// read is counted, never silently dropped: the UI says so and refuses to write the list back,
// since a write-back would overwrite the lines it didn't understand.

import { isChildLine, KEY_LINE_RE, splitFrontmatter, unquote } from "./frontmatter";

export const URL_REFERENCES_KEY = "references";

/** A note is one sentence saying when to open the link. */
export const MAX_URL_REFERENCE_NOTE_LENGTH = 120;

export interface UrlReference {
  url: string;
  /** When the link should be opened. Empty when the author left none. */
  note: string;
}

export interface ParsedUrlReferences {
  references: UrlReference[];
  /** Lines under `references` that could not be read as a link. Non-zero means the UI must not write the list back. */
  invalidCount: number;
}

/** Whether `raw` is an absolute http(s) URL — the only kind a URL reference may hold. */
export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Normalizes user input into the URL that gets stored, or undefined when it isn't an http(s) URL.
 * A missing scheme is assumed to be https, since that is how people paste links from a browser bar.
 */
export function normalizeHttpUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isHttpUrl(candidate) ? new URL(candidate).href : undefined;
}

// `[note](url)` or `[note](<url>)`. The note may contain backslash-escaped characters; the URL
// runs to the closing parenthesis at the very end, so parentheses inside it survive.
const MARKDOWN_LINK_RE = /^\[((?:\\.|[^\\\]])*)\]\((?:<([^>]*)>|(\S+))\)$/;

/** Reads one list item (already unquoted) as a URL reference, or null when it is neither a markdown link nor a bare URL. */
export function parseUrlReferenceItem(item: string): UrlReference | null {
  const text = item.trim();
  const link = MARKDOWN_LINK_RE.exec(text);
  if (link) {
    const url = (link[2] ?? link[3] ?? "").trim();
    if (!isHttpUrl(url)) return null;
    return { url, note: link[1].replace(/\\(.)/g, "$1").trim() };
  }
  return isHttpUrl(text) ? { url: text, note: "" } : null;
}

/** Writes one URL reference as the list item it is stored as, before YAML quoting. */
export function serializeUrlReferenceItem(reference: UrlReference): string {
  const note = reference.note.replace(/\s+/g, " ").trim();
  if (note === "") return reference.url;
  return `[${note.replace(/[\\[\]]/g, "\\$&")}](${reference.url})`;
}

const yamlDoubleQuote = (raw: string): string => `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Splits the inside of a flow list (`a, "b, c"`) on commas that are not inside quotes.
function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"' && i + 1 < inner.length) {
        current += inner[++i];
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

interface ReferencesBlock {
  /** Index of the `references:` line within the frontmatter lines. */
  start: number;
  /** One past the last line belonging to the key (trailing blank lines excluded). */
  end: number;
}

function findReferencesBlock(lines: string[]): ReferencesBlock | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isChildLine(line)) continue;
    const keyMatch = KEY_LINE_RE.exec(line);
    if (!keyMatch || keyMatch[1].trim() !== URL_REFERENCES_KEY) continue;
    let end = i + 1;
    for (let j = i + 1; j < lines.length && isChildLine(lines[j]); j++) {
      if (lines[j].trim() !== "") end = j + 1;
    }
    return { start: i, end };
  }
  return undefined;
}

/** Reads a document's URL references from its frontmatter. */
export function parseUrlReferences(content: string): ParsedUrlReferences {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === "") return { references: [], invalidCount: 0 };
  const lines = frontmatter.split("\n");
  const block = findReferencesBlock(lines);
  if (!block) return { references: [], invalidCount: 0 };

  const references: UrlReference[] = [];
  let invalidCount = 0;
  const take = (raw: string) => {
    const item = unquote(raw.trim());
    if (item === "") return;
    const reference = parseUrlReferenceItem(item);
    if (reference) references.push(reference);
    else invalidCount++;
  };

  const inline = (KEY_LINE_RE.exec(lines[block.start])?.[2] ?? "").trim();
  if (inline !== "") {
    // A single item written inline, or a flow list of them. Try the item first: an unquoted
    // `[note](url)` also starts with a bracket.
    if (parseUrlReferenceItem(unquote(inline))) take(inline);
    else if (inline.startsWith("[") && inline.endsWith("]")) splitFlowItems(inline.slice(1, -1)).forEach(take);
    else invalidCount++;
  }

  for (const line of lines.slice(block.start + 1, block.end)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const item = /^[ \t]*-(?:[ \t]+(.*))?$/.exec(line);
    if (item) take(item[1] ?? "");
    else invalidCount++;
  }

  return { references, invalidCount };
}

/**
 * Returns `content` with its URL references replaced by `references`, in the canonical form. Only
 * the `references` block changes; every other frontmatter line is kept as it is. An empty list
 * removes the key, and a frontmatter block left with nothing in it is removed too. A document
 * without frontmatter gets one when its first reference is added.
 */
export function setUrlReferences(content: string, references: UrlReference[]): string {
  const replacement =
    references.length === 0
      ? []
      : [`${URL_REFERENCES_KEY}:`, ...references.map((reference) => `  - ${yamlDoubleQuote(serializeUrlReferenceItem(reference))}`)];

  const normalised = content.replace(/\r\n/g, "\n");
  const opensWithFrontmatter = /^---[ \t]*\n/.test(normalised) && splitFrontmatter(normalised).body !== normalised;
  if (!opensWithFrontmatter) {
    if (replacement.length === 0) return content;
    return `---\n${replacement.join("\n")}\n---\n${normalised}`;
  }

  const { frontmatter, body } = splitFrontmatter(normalised);
  const lines = frontmatter === "" ? [] : frontmatter.split("\n");
  const block = findReferencesBlock(lines);
  if (!block && replacement.length === 0) return content;
  const next = block ? [...lines.slice(0, block.start), ...replacement, ...lines.slice(block.end)] : [...lines, ...replacement];

  if (next.every((line) => line.trim() === "")) return body;
  return `---\n${next.join("\n")}\n---\n${body}`;
}
