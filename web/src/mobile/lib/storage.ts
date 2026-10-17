import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-device preferences for the mobile reader (recent reads, shelf view, reading
 * size …). Everything here is a convenience: a private window or blocked storage
 * must leave the app fully usable, so every access is guarded and falls back.
 */
const PREFIX = "toucan-mobile:";
const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

export function readPref<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) value = JSON.parse(raw) as T;
  } catch {
    // Unavailable or corrupt: use the fallback.
  }
  cache.set(key, value);
  return value;
}

export function writePref<T>(key: string, value: T): void {
  cache.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Keep the in-memory value for this session.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readPref(key, fallback),
    () => fallback,
  );
  const set = useCallback((next: T) => writePref(key, next), [key]);
  return [value, set];
}

/** Test hook: forget cached values so the next read goes back to storage. */
export function resetPrefCache(): void {
  cache.clear();
}
