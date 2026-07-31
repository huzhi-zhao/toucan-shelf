import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

/**
 * Reader preferences for the vertical rhythm of rendered documents. These say how *this person*
 * likes to read, so they belong neither in a document's frontmatter nor in its stored view
 * configuration (see `docConfig.ts` for those).
 *
 * They stay in localStorage rather than syncing through user settings on purpose — the right
 * density depends on the screen in front of you, so a 27" desktop and a phone should be free
 * to disagree.
 *
 * Two layers:
 *  - `compactReading` picks the *preset* (the `--md-*` token sets in index.css: the dense
 *    feed rhythm vs. the roomy long-form one).
 *  - `lineSpacing` / `paragraphSpacing` are free numeric overrides on top of that preset.
 *    `null` means "no override" — the preset's own value applies, and resetting a slider
 *    returns it to exactly that.
 */

const COMPACT_KEY = "memos-compact-reading";
const LINE_SPACING_KEY = "memos-reading-line-spacing";
const PARAGRAPH_SPACING_KEY = "memos-reading-paragraph-spacing";

const listeners = new Set<() => void>();

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    // localStorage might not be available (SSR, private browsing, etc.)
    return null;
  }
};

const writeStorage = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Preference is still applied for this session; it just won't survive a reload.
  }
};

/** Slider bounds. Kept wide enough to be useful, narrow enough that no setting is unreadable. */
export const LINE_SPACING_RANGE = { min: 1.3, max: 2.4, step: 0.05 } as const;
/** In rem — the gap below paragraphs, lists, quotes, tables… */
export const PARAGRAPH_SPACING_RANGE = { min: 0, max: 2, step: 0.05 } as const;

/**
 * What each density preset resolves to, mirroring the `--md-leading` / `--md-block-gap` values
 * in index.css. The sliders show these while no override is set, so the handle always starts
 * where the text actually is, and "reset" is visibly a return to the suggested value.
 */
export const PRESET_SPACING = {
  compact: { line: 1.5, paragraph: 0.5 },
  reading: { line: 1.75, paragraph: 1 },
} as const;

const clamp = (value: number, { min, max }: { min: number; max: number }): number => Math.min(max, Math.max(min, value));

const parseSpacing = (raw: string | null, range: { min: number; max: number }): number | null => {
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clamp(parsed, range) : null;
};

let compact = readStorage(COMPACT_KEY) === "1";
let lineSpacing = parseSpacing(readStorage(LINE_SPACING_KEY), LINE_SPACING_RANGE);
let paragraphSpacing = parseSpacing(readStorage(PARAGRAPH_SPACING_KEY), PARAGRAPH_SPACING_RANGE);

export const getCompactReading = (): boolean => compact;

export const setCompactReading = (value: boolean): void => {
  compact = value;
  writeStorage(COMPACT_KEY, value ? "1" : "0");
  notify();
};

export const getLineSpacing = (): number | null => lineSpacing;

/** Pass `null` to clear the override and fall back to the active preset. */
export const setLineSpacing = (value: number | null): void => {
  lineSpacing = value === null ? null : clamp(value, LINE_SPACING_RANGE);
  writeStorage(LINE_SPACING_KEY, lineSpacing === null ? null : String(lineSpacing));
  notify();
};

export const getParagraphSpacing = (): number | null => paragraphSpacing;

/** Pass `null` to clear the override and fall back to the active preset. */
export const setParagraphSpacing = (value: number | null): void => {
  paragraphSpacing = value === null ? null : clamp(value, PARAGRAPH_SPACING_RANGE);
  writeStorage(PARAGRAPH_SPACING_KEY, paragraphSpacing === null ? null : String(paragraphSpacing));
  notify();
};

export const subscribeReadingPreferences = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The overrides as inline custom properties, or `undefined` when neither is set (the common
 * case — nothing is added to the DOM unless the reader asked for it). Inline vars beat the
 * preset's class-level ones, so this composes with either density.
 */
export const getReadingSpacingStyle = (): CSSProperties | undefined => {
  if (lineSpacing === null && paragraphSpacing === null) {
    return undefined;
  }
  const style: Record<string, string> = {};
  if (lineSpacing !== null) {
    style["--md-leading"] = String(lineSpacing);
  }
  if (paragraphSpacing !== null) {
    style["--md-block-gap"] = `${paragraphSpacing}rem`;
  }
  return style as CSSProperties;
};

const snapshot = () => ({ compact, lineSpacing, paragraphSpacing });
let cachedSnapshot = snapshot();

/**
 * All reading preferences as a live value: the `density` prop MemoContent expects, the raw
 * overrides plus the values the sliders should display (`effective*`), and the inline style
 * that applies them.
 */
export function useReadingDensity(): {
  compact: boolean;
  density: "compact" | "reading";
  lineSpacing: number | null;
  paragraphSpacing: number | null;
  /** The line height in force, override or preset — what the slider handle sits on. */
  effectiveLineSpacing: number;
  /** The paragraph gap (rem) in force, override or preset. */
  effectiveParagraphSpacing: number;
  spacingStyle: CSSProperties | undefined;
} {
  const value = useSyncExternalStore(
    subscribeReadingPreferences,
    () => {
      // useSyncExternalStore compares snapshots by identity, so only mint a new object when
      // something actually changed.
      if (
        cachedSnapshot.compact !== compact ||
        cachedSnapshot.lineSpacing !== lineSpacing ||
        cachedSnapshot.paragraphSpacing !== paragraphSpacing
      ) {
        cachedSnapshot = snapshot();
      }
      return cachedSnapshot;
    },
    () => cachedSnapshot,
  );

  const preset = value.compact ? PRESET_SPACING.compact : PRESET_SPACING.reading;

  return {
    compact: value.compact,
    density: value.compact ? "compact" : "reading",
    lineSpacing: value.lineSpacing,
    paragraphSpacing: value.paragraphSpacing,
    effectiveLineSpacing: value.lineSpacing ?? preset.line,
    effectiveParagraphSpacing: value.paragraphSpacing ?? preset.paragraph,
    spacingStyle: getReadingSpacingStyle(),
  };
}
