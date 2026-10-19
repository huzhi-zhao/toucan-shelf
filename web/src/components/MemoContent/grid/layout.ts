import type { GridBlockData, GridCardData } from "./parseGridBlock";

// Which layout each card gets, and where a text card puts its fields, are shared
// by the web grid and the mobile reader's read-only preview (mobile-phase3.md §4),
// so both show the same values in the same places.

/** A card's layout: a two-line strip, a text card with fields, or a cover image over a few lines. */
export type GridCardKind = "longbar" | "text" | "cover";

/**
 * Whether the whole grid draws without covers: when asked to (`nocover: true`), or
 * when no card carries a cover, so the grid never shows a wall of empty placeholders.
 */
export function gridHidesCovers(data: Pick<GridBlockData, "cards" | "nocover">): boolean {
  return data.nocover || data.cards.every((card) => !card.cover);
}

/** The layout for one card, given the grid's style and whether the grid hides covers (see gridHidesCovers). */
export function gridCardKind(card: GridCardData, longbar: boolean, hideCovers: boolean): GridCardKind {
  if (longbar) return "longbar";
  return hideCovers || card.nocover ? "text" : "cover";
}

// A no-cover text card fits within this many text rows (title + subtitle count
// toward it), keeping the wall of cards visually even.
const MAX_TEXT_CARD_ROWS = 6;

// Splits a card's extra fields into the slots of a text card: a trailing footer
// (date / note, pinned to the bottom, full width), and the remaining fields laid
// out two-per-row (a 50/50 split, left value + right value) starting at the lead
// "price" row. Rows are capped so the whole card stays within the 6-row budget.
export function textCardSlots(card: GridCardData) {
  const fields = card.fields;
  // A trailing field becomes the footer only when there is a body field ahead of it.
  const footer = fields.length >= 2 ? fields[fields.length - 1] : undefined;
  const body = footer ? fields.slice(0, -1) : fields;

  // Row budget: title(1) + subtitle? + footer? leaves this many rows for body,
  // each row holding up to two fields.
  const used = 1 + (card.subtitle ? 1 : 0) + (footer ? 1 : 0);
  const rowBudget = Math.max(0, MAX_TEXT_CARD_ROWS - used);
  const visible = body.slice(0, rowBudget * 2);

  const rows: { left?: (typeof visible)[number]; right?: (typeof visible)[number] }[] = [];
  for (let i = 0; i < visible.length; i += 2) {
    rows.push({ left: visible[i], right: visible[i + 1] });
  }

  return { rows, footer };
}
