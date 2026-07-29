// Obsidian-style "properties" support.
//
// A memo may open with a YAML frontmatter block delimited by `---` on the very
// first line and a closing `---` line, e.g.
//
//   ---
//   title: AI Ethics Week 1
//   tags: [ai, ethics]
//   status: completed
//   date: 2026-07-11
//   ---
//   # body starts here
//
// We only recognise the flat, scalar/list shape Obsidian supports. Anything that
// doesn't fit the spec (nested maps, arrays of objects, malformed lines) is
// silently ignored — never rendered — per the product requirement. The parser is
// deliberately line-based rather than a full YAML engine: Obsidian properties are
// intentionally flat, so this both keeps us dependency-free and makes rejecting
// non-compliant (nested) values fall out naturally.

export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime" | "select";

export interface MemoProperty {
  key: string;
  type: PropertyType;
  /** Normalised value: string for text/date/datetime/select, number, boolean, or string[] for lists. null = empty. */
  value: string | number | boolean | string[] | null;
}

// Single-select ("one of a fixed set") is deliberately *not* inferred from the document: there is
// no syntax that distinguishes `status: done` from any other text. Instead a small set of reserved
// keys carries a system-defined option list, and a value from that list classifies as `select`.
// A reserved key holding anything else stays text, so authors are never locked out of their own
// wording — it simply doesn't get the chip/dropdown treatment.
export const SELECT_PROPERTY_OPTIONS: Record<string, readonly string[]> = {
  status: ["created", "in-process", "done"],
  priority: ["p0", "p1", "p2", "p3"],
};

/** The option list for a reserved single-select key, or undefined for any other key. */
export function selectOptionsFor(key: string): readonly string[] | undefined {
  return Object.hasOwn(SELECT_PROPERTY_OPTIONS, key) ? SELECT_PROPERTY_OPTIONS[key] : undefined;
}

export interface ParsedContent {
  /** Compliant properties in document order. Empty when there is no frontmatter. */
  properties: MemoProperty[];
  /** The markdown body with any frontmatter block stripped. */
  body: string;
}

// Frontmatter must be the very first thing in the document. Capture the inner
// block (group 1) and the trailing body (group 2). Operates on `\n`-normalised
// input so CRLF documents parse identically.
const FRONTMATTER_RE = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n([\s\S]*))?$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

// Strip matching surrounding quotes from a scalar and unescape the minimal set a
// double-quoted YAML scalar cares about. Unquoted input is returned unchanged.
function unquote(raw: string): string {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
  }
  if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") {
    // Single-quoted YAML only escapes '' -> '.
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

// Split a flow list body ("a, b, c" from `[a, b, c]`) into trimmed, unquoted
// items, dropping empties. No nesting is supported — that's outside the spec.
function parseFlowList(inner: string): string[] {
  return inner
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

// Classify + normalise a single inline scalar value into a typed property.
function classifyScalar(key: string, raw: string): MemoProperty {
  // Flow list: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return { key, type: "list", value: parseFlowList(raw.slice(1, -1)) };
  }

  // Quoted values are always text, regardless of what they look like inside.
  const quoted = raw[0] === '"' || raw[0] === "'";
  const value = unquote(raw);

  // A reserved key holding one of its built-in options. Quoting is incidental here — the value
  // is an identifier from a closed set either way.
  if (selectOptionsFor(key)?.includes(value)) {
    return { key, type: "select", value };
  }

  if (!quoted) {
    if (raw === "true" || raw === "false") {
      return { key, type: "checkbox", value: raw === "true" };
    }
    if (raw === "null" || raw === "~") {
      return { key, type: "text", value: null };
    }
    if (NUMBER_RE.test(raw)) {
      return { key, type: "number", value: Number(raw) };
    }
    if (DATE_RE.test(raw)) {
      return { key, type: "date", value: raw };
    }
    if (DATETIME_RE.test(raw)) {
      return { key, type: "datetime", value: raw };
    }
  }

  return { key, type: "text", value };
}

const KEY_LINE_RE = /^([^:\s][^:]*):(.*)$/;

// True for a line that belongs to the block *under* a key: blank, or indented.
const isChildLine = (line: string): boolean => line.trim() === "" || /^[ \t]/.test(line);

/**
 * Parse a memo's raw markdown, splitting off any leading Obsidian-style
 * frontmatter. Returns the compliant properties and the body with the block
 * removed. When there is no frontmatter, `properties` is empty and `body` is the
 * original content unchanged.
 */
export function parseFrontmatter(content: string): ParsedContent {
  const normalised = content.replace(/\r\n/g, "\n");
  const match = FRONTMATTER_RE.exec(normalised);
  if (!match) {
    return { properties: [], body: content };
  }

  const inner = match[1] ?? "";
  const body = match[2] ?? "";
  const lines = inner.split("\n");
  const properties: MemoProperty[] = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blanks, comments, and stray indented lines with no parent key.
    if (trimmed === "" || trimmed.startsWith("#") || /^[ \t]/.test(line)) {
      i++;
      continue;
    }

    const keyMatch = KEY_LINE_RE.exec(line);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1].trim();
    const rest = keyMatch[2].trim();
    i++;

    // Gather the child block (indented / blank lines that follow this key).
    const children: string[] = [];
    while (i < lines.length && isChildLine(lines[i])) {
      if (lines[i].trim() !== "") {
        children.push(lines[i]);
      }
      i++;
    }

    // Duplicate keys: first occurrence wins (matches Obsidian's dedupe).
    if (key === "" || seen.has(key)) {
      continue;
    }

    if (rest !== "") {
      // Inline value. Any child block underneath an inline scalar is malformed
      // for our purposes, but the scalar itself is still valid — keep it.
      seen.add(key);
      properties.push(classifyScalar(key, rest));
      continue;
    }

    // Empty inline value: the type is decided by the child block.
    if (children.length === 0) {
      seen.add(key);
      // An empty reserved key is still a select — that's how an unset `status:` offers its
      // dropdown rather than a text box.
      properties.push({ key, type: selectOptionsFor(key) ? "select" : "text", value: null });
      continue;
    }

    // A block list: every child is a `- item` entry.
    const listItems: string[] = [];
    let isList = true;
    for (const child of children) {
      const itemMatch = /^[ \t]+-[ \t]*(.*)$/.exec(child);
      if (!itemMatch) {
        isList = false;
        break;
      }
      const item = unquote(itemMatch[1].trim());
      if (item !== "") {
        listItems.push(item);
      }
    }

    if (isList) {
      seen.add(key);
      properties.push({ key, type: "list", value: listItems });
    }
    // Otherwise the child block is a nested map (or something unrecognised):
    // non-compliant, so the whole key is ignored.
  }

  return { properties, body };
}

// --- Writing back -----------------------------------------------------------------------
//
// The properties panel edits values in place, so only the one line being changed is rewritten:
// everything else in the block (comments, blank lines, keys we don't understand, key order)
// survives untouched.

const doubleQuote = (raw: string): string => `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

// Whether a string has to be quoted to survive a round trip: either YAML itself would mis-read it
// (leading indicator character, a `key: value` lookalike, surrounding whitespace) or our own
// classifier would hand it back as a different type than the one being written.
function needsQuoting(raw: string): boolean {
  if (raw === "") return true;
  if (raw !== raw.trim()) return true;
  if (/^[[\]{}#&*!|>'"%@`,-]/.test(raw)) return true;
  if (/:(\s|$)/.test(raw)) return true;
  if (raw === "true" || raw === "false" || raw === "null" || raw === "~") return true;
  return NUMBER_RE.test(raw) || DATE_RE.test(raw) || DATETIME_RE.test(raw);
}

const serializeScalar = (raw: string): string => (needsQuoting(raw) ? doubleQuote(raw) : raw);

// Flow-list items live inside `[...]`, so a comma or bracket in the item itself must be quoted
// on top of the usual scalar rules.
const serializeListItem = (raw: string): string => (/[,[\]]/.test(raw) ? doubleQuote(raw) : serializeScalar(raw));

/**
 * Renders a property value as the YAML text that follows `key:`. Returns "" for an empty value,
 * which the caller writes as a bare `key:` line.
 */
export function serializePropertyValue(value: MemoProperty["value"]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (Array.isArray(value)) return `[${value.map(serializeListItem).join(", ")}]`;
  return value === "" ? "" : serializeScalar(value);
}

/**
 * Returns `content` with the frontmatter property `key` set to `value`, adding the key at the end
 * of the block when it isn't there yet. Content without a frontmatter block is returned unchanged
 * — the panel only ever edits properties a document already declares.
 */
export function setFrontmatterProperty(content: string, key: string, value: MemoProperty["value"]): string {
  const normalised = content.replace(/\r\n/g, "\n");
  const match = FRONTMATTER_RE.exec(normalised);
  if (!match) return content;

  const inner = match[1] ?? "";
  const body = match[2] ?? "";
  const lines = inner === "" ? [] : inner.split("\n");
  const serialized = serializePropertyValue(value);
  const newLine = serialized === "" ? `${key}:` : `${key}: ${serialized}`;

  const out: string[] = [];
  let replaced = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = /^[ \t]/.test(line) ? null : KEY_LINE_RE.exec(line);
    if (!replaced && keyMatch && keyMatch[1].trim() === key) {
      out.push(newLine);
      replaced = true;
      i++;
      // Drop whatever block was indented under the old key (e.g. a `- item` list), since the
      // replacement carries the whole value inline.
      while (i < lines.length && /^[ \t]/.test(lines[i])) i++;
      continue;
    }
    out.push(line);
    i++;
  }
  if (!replaced) out.push(newLine);

  return `---\n${out.join("\n")}\n---\n${body}`;
}

/** Whether the content already opens with a frontmatter block (compliant or not). */
export function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_RE.test(content.replace(/\r\n/g, "\n"));
}

/**
 * Splits a leading frontmatter block off, returning the raw inner text (without
 * the `---` delimiters) and the remaining body. Unlike parseFrontmatter this
 * preserves the frontmatter verbatim, so it can round-trip through an editor.
 * When there is no frontmatter, `frontmatter` is "" and `body` is the original.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = FRONTMATTER_RE.exec(content.replace(/\r\n/g, "\n"));
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}
