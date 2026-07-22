// The palette a text mark (highlight background or underline) can use, shared by every
// reader that supports marking text — EPUB attachments and notebook documents alike, so a
// yellow mark means the same thing and looks the same wherever it was made.
//
// Annotations store the preset *key*, not the concrete color, so the palette can be retuned
// (or made theme-aware) later without rewriting stored data.
export interface MarkColor {
  key: string;
  /** Concrete color used both for the highlight fill and the underline stroke. */
  color: string;
}

export const MARK_COLORS: MarkColor[] = [
  { key: "yellow", color: "#f2c94c" },
  { key: "green", color: "#6fcf97" },
  { key: "blue", color: "#56ccf2" },
  { key: "pink", color: "#f48fb1" },
  { key: "red", color: "#eb5757" },
  { key: "purple", color: "#bb6bd9" },
];

export const DEFAULT_MARK_COLOR = MARK_COLORS[0].key;

/** Resolve a stored color key to its preset, falling back to the default when unknown/empty. */
export function getMarkColor(key?: string): MarkColor {
  return MARK_COLORS.find((c) => c.key === key) ?? MARK_COLORS[0];
}

/**
 * Applies an alpha to a palette color. Highlights are drawn *over* the text (so they can be
 * clicked), which only reads as a highlighter rather than a blindfold at a low alpha.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
