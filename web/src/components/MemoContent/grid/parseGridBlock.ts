/** One extra, free-form field on a card (anything beyond the known keys), kept in source order. */
export interface GridCardField {
  key: string;
  value: string;
}

export interface GridCardData {
  title: string;
  subtitle?: string;
  cover?: string;
  url?: string;
  /** `true` renders a pure-text card even when a cover is configured. */
  nocover?: boolean;
  /** Extra `key: value` fields, in source order, rendered below the subtitle on text cards. */
  fields: GridCardField[];
}

/** How the whole grid renders. `card` = cover cards (default); `longbar` = two-line text strips, never showing a cover. */
export type GridStyle = "card" | "longbar";

export interface GridBlockData {
  cards: GridCardData[];
  style: GridStyle;
  /** Block-level default: when `true` no card shows a cover, even if one is set. */
  nocover: boolean;
  /** Fixed column count (`columns: N`, clamped 1–8). Undefined = auto-fill by width. */
  columns?: number;
}

// Keys may be any script (e.g. `价格: ¥8,000`): a letter or `_`, then letters, marks, digits or `_`.
// Requiring a leading letter keeps value-like lines such as `10:30` from being read as a key.
// Matching stops at the first `:`, so colons inside values (`url: https://…`) stay in the value.
const KEY = String.raw`[\p{L}_][\p{L}\p{M}\p{N}_]*`;
const CARD_LINE_RE = new RegExp(String.raw`^-\s+(${KEY}):\s*(.*)$`, "u");
const FIELD_LINE_RE = new RegExp(String.raw`^\s+(${KEY}):\s*(.*)$`, "u");
const CONFIG_LINE_RE = new RegExp(String.raw`^(${KEY}):\s*(.*)$`, "u");

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isTrue(value: string): boolean {
  return unquote(value).toLowerCase() === "true";
}

function setField(card: Partial<GridCardData> & { fields: GridCardField[] }, key: string, rawValue: string) {
  const lowerKey = key.toLowerCase();
  const value = unquote(rawValue);
  switch (lowerKey) {
    case "title":
      card.title = value;
      break;
    case "subtitle":
      card.subtitle = value || undefined;
      break;
    case "cover":
      card.cover = value || undefined;
      break;
    case "url":
      card.url = value || undefined;
      break;
    case "nocover":
      card.nocover = isTrue(rawValue);
      break;
    default:
      // Any other key becomes an ordered display field. Empty values are dropped
      // (they add a blank row for no gain).
      if (value) card.fields.push({ key, value });
      break;
  }
}

/**
 * Parses a `grid` fenced code block into a block config plus its cards.
 *
 * Top-level `key: value` lines before the first `- ` entry are block config:
 * `style: longbar` (or its alias `type: longbar`) renders two-line title +
 * subtitle strips and nothing else; `nocover: true` hides covers on every card.
 * Unknown top-level keys are ignored.
 *
 * Within a card, known keys (title/subtitle/cover/url/nocover) drive the layout;
 * any other `key: value` line is collected in order as a display field.
 */
export function parseGridBlock(raw: string): GridBlockData {
  const cards: (Partial<GridCardData> & { fields: GridCardField[] })[] = [];
  let current: (Partial<GridCardData> & { fields: GridCardField[] }) | undefined;
  let style: GridStyle = "card";
  let nocover = false;
  let columns: number | undefined;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const cardMatch = CARD_LINE_RE.exec(line);
    if (cardMatch) {
      current = { fields: [] };
      cards.push(current);
      setField(current, cardMatch[1], cardMatch[2]);
      continue;
    }

    if (!current) {
      // Block-level config lines, before the first card entry.
      const configMatch = CONFIG_LINE_RE.exec(line);
      if (configMatch) {
        const key = configMatch[1].toLowerCase();
        // `type` is accepted as an alias for `style`.
        if (key === "style" || key === "type") {
          style = unquote(configMatch[2]).toLowerCase() === "longbar" ? "longbar" : "card";
        } else if (key === "nocover") {
          nocover = isTrue(configMatch[2]);
        } else if (key === "columns") {
          const n = Number.parseInt(unquote(configMatch[2]), 10);
          if (Number.isFinite(n)) columns = Math.min(8, Math.max(1, n));
        }
      }
      continue;
    }

    const fieldMatch = FIELD_LINE_RE.exec(line);
    if (fieldMatch) {
      setField(current, fieldMatch[1], fieldMatch[2]);
    }
  }

  const parsed = cards
    .filter((c): c is Partial<GridCardData> & { fields: GridCardField[]; title: string } => !!c.title)
    .map((c) => ({ ...c, title: c.title, fields: c.fields }) as GridCardData);

  return { cards: parsed, style, nocover, columns };
}
