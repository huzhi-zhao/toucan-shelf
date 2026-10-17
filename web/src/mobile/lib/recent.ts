import { readPref, writePref } from "./storage";

/**
 * "Recently read" on the shelf. Kept on this device only (requirement §4): a
 * snapshot of what is needed to draw the card, so the shelf shows it without a
 * request per entry.
 */
export interface RecentRead {
  memoName: string;
  title: string;
  icon: string;
  workspaceTitle: string;
}

export const RECENT_KEY = "recent-reads";
export const RECENT_LIMIT = 8;

export function addRecentRead(list: RecentRead[], entry: RecentRead): RecentRead[] {
  return [entry, ...list.filter((r) => r.memoName !== entry.memoName)].slice(0, RECENT_LIMIT);
}

export function removeRecentRead(list: RecentRead[], memoName: string): RecentRead[] {
  return list.filter((r) => r.memoName !== memoName);
}

export function rememberRead(entry: RecentRead): void {
  writePref(RECENT_KEY, addRecentRead(readPref<RecentRead[]>(RECENT_KEY, []), entry));
}

/** A recent entry whose document is gone or no longer readable leaves the shelf. */
export function forgetRead(memoName: string): void {
  const list = readPref<RecentRead[]>(RECENT_KEY, []);
  if (list.some((r) => r.memoName === memoName)) writePref(RECENT_KEY, removeRecentRead(list, memoName));
}
