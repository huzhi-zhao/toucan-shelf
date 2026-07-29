import { useSyncExternalStore } from "react";

const STORAGE_KEY = "memos-compact-reading";

const listeners = new Set<() => void>();

/**
 * Whether documents render at the compact (dense) vertical rhythm instead of the long-form
 * reading rhythm. This is a *reader* preference, not a property of any document: it says how
 * this person likes to read, so it belongs neither in the document's frontmatter nor in its
 * stored view configuration (see `docConfig.ts` for those).
 *
 * It stays in localStorage rather than syncing through user settings on purpose — the right
 * density depends on the screen in front of you, so a 27" desktop and a phone should be free
 * to disagree.
 */
const read = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

let compact = read();

export const getCompactReading = (): boolean => compact;

export const setCompactReading = (value: boolean): void => {
  compact = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage might not be available (SSR, private browsing, etc.)
  }
  listeners.forEach((listener) => listener());
};

export const subscribeCompactReading = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The preference as a live value, and the `density` prop MemoContent expects. */
export function useReadingDensity(): { compact: boolean; density: "compact" | "reading" } {
  const value = useSyncExternalStore(subscribeCompactReading, getCompactReading, () => false);
  return { compact: value, density: value ? "compact" : "reading" };
}
