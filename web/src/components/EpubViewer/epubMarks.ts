// The palette of colors an EPUB text mark (highlight background or underline) can use.
// Stored on the annotation as `color` (the preset key), resolved to a concrete color here so
// the key survives theme changes and stays stable across clients.
export interface EpubMarkColor {
  key: string;
  /** Concrete color used both for the highlight fill and the underline stroke. */
  color: string;
}

export const EPUB_MARK_COLORS: EpubMarkColor[] = [
  { key: "yellow", color: "#f2c94c" },
  { key: "green", color: "#6fcf97" },
  { key: "blue", color: "#56ccf2" },
  { key: "pink", color: "#f48fb1" },
  { key: "red", color: "#eb5757" },
  { key: "purple", color: "#bb6bd9" },
];

export const DEFAULT_MARK_COLOR = EPUB_MARK_COLORS[0].key;

/** Resolve a stored color key to its preset, falling back to the default when unknown/empty. */
export function getMarkColor(key?: string): EpubMarkColor {
  return EPUB_MARK_COLORS.find((c) => c.key === key) ?? EPUB_MARK_COLORS[0];
}
