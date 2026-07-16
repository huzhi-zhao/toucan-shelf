export interface GridCardData {
  title: string;
  subtitle?: string;
  cover?: string;
  url?: string;
}

const CARD_LINE_RE = /^-\s+([A-Za-z_]+):\s*(.*)$/;
const FIELD_LINE_RE = /^\s+([A-Za-z_]+):\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function setField(card: Partial<GridCardData>, key: string, rawValue: string) {
  const value = unquote(rawValue);
  switch (key.toLowerCase()) {
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
    default:
      break;
  }
}

/**
 * Parses a `grid` fenced code block into a list of cards.
 *
 * Top-level `key: value` lines before the first `- ` entry (e.g. `layout: card`,
 * `columns: 4`) are config hints for forward-compatibility and are currently ignored:
 * card layout always auto-fills the available width (see GridBlock.tsx).
 */
export function parseGridBlock(raw: string): GridCardData[] {
  const cards: Partial<GridCardData>[] = [];
  let current: Partial<GridCardData> | undefined;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const cardMatch = CARD_LINE_RE.exec(line);
    if (cardMatch) {
      current = {};
      cards.push(current);
      setField(current, cardMatch[1], cardMatch[2]);
      continue;
    }

    if (!current) continue; // Skip config lines before the first card entry.

    const fieldMatch = FIELD_LINE_RE.exec(line);
    if (fieldMatch) {
      setField(current, fieldMatch[1], fieldMatch[2]);
    }
  }

  return cards.filter((c): c is GridCardData => !!c.title);
}
