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
 *  - `lineSpacing` / `paragraphSpacing` are optional overrides on top of that preset, for
 *    readers who want to fine-tune. `"auto"` (the default) leaves the preset's value alone.
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

const writeStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference is still applied for this session; it just won't survive a reload.
  }
};

/** Fine-tuning steps. `auto` defers to whichever density preset is active. */
export type SpacingChoice = "auto" | "tight" | "normal" | "loose";

const SPACING_CHOICES: SpacingChoice[] = ["auto", "tight", "normal", "loose"];

/** `--md-leading` (unitless line-height) per explicit choice. */
const lineSpacingValues: Record<Exclude<SpacingChoice, "auto">, string> = {
  tight: "1.5",
  normal: "1.75",
  loose: "2.05",
};

/** `--md-block-gap` (the gap below paragraphs, lists, quotes, tables…) per explicit choice. */
const paragraphSpacingValues: Record<Exclude<SpacingChoice, "auto">, string> = {
  tight: "0.5rem",
  normal: "1rem",
  loose: "1.5rem",
};

const parseSpacing = (raw: string | null): SpacingChoice =>
  SPACING_CHOICES.includes(raw as SpacingChoice) ? (raw as SpacingChoice) : "auto";

let compact = readStorage(COMPACT_KEY) === "1";
let lineSpacing = parseSpacing(readStorage(LINE_SPACING_KEY));
let paragraphSpacing = parseSpacing(readStorage(PARAGRAPH_SPACING_KEY));

export const getCompactReading = (): boolean => compact;

export const setCompactReading = (value: boolean): void => {
  compact = value;
  writeStorage(COMPACT_KEY, value ? "1" : "0");
  notify();
};

export const getLineSpacing = (): SpacingChoice => lineSpacing;

export const setLineSpacing = (value: SpacingChoice): void => {
  lineSpacing = value;
  writeStorage(LINE_SPACING_KEY, value);
  notify();
};

export const getParagraphSpacing = (): SpacingChoice => paragraphSpacing;

export const setParagraphSpacing = (value: SpacingChoice): void => {
  paragraphSpacing = value;
  writeStorage(PARAGRAPH_SPACING_KEY, value);
  notify();
};

export const subscribeReadingPreferences = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** @deprecated Kept as the old name of {@link subscribeReadingPreferences}. */
export const subscribeCompactReading = subscribeReadingPreferences;

/**
 * The spacing overrides as inline custom properties, or `undefined` when both are `auto`
 * (the common case — nothing is added to the DOM unless the reader asked for it).
 * Inline vars beat the preset's class-level ones, so this composes with either density.
 */
export const getReadingSpacingStyle = (): CSSProperties | undefined => {
  if (lineSpacing === "auto" && paragraphSpacing === "auto") {
    return undefined;
  }
  const style: Record<string, string> = {};
  if (lineSpacing !== "auto") {
    style["--md-leading"] = lineSpacingValues[lineSpacing];
  }
  if (paragraphSpacing !== "auto") {
    style["--md-block-gap"] = paragraphSpacingValues[paragraphSpacing];
  }
  return style as CSSProperties;
};

const snapshot = () => ({ compact, lineSpacing, paragraphSpacing });
let cachedSnapshot = snapshot();

/**
 * All reading preferences as a live value: the `density` prop MemoContent expects, the two
 * spacing choices (for the settings UI), and the inline style that applies the overrides.
 */
export function useReadingDensity(): {
  compact: boolean;
  density: "compact" | "reading";
  lineSpacing: SpacingChoice;
  paragraphSpacing: SpacingChoice;
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

  return {
    compact: value.compact,
    density: value.compact ? "compact" : "reading",
    lineSpacing: value.lineSpacing,
    paragraphSpacing: value.paragraphSpacing,
    spacingStyle: getReadingSpacingStyle(),
  };
}
