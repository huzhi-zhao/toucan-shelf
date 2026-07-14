// Client-side cache of "where was I reading" for a document preview, so reopening the
// same document (PDF or markdown) jumps back to the last spot instead of the top.
// Keyed by a stable resource name (e.g. `attachments/{uid}` or a memo name), not the URL,
// since URLs can carry auth/query params that change between opens of the same file.
const STORAGE_PREFIX = "doc-scroll-pos:";

export interface DocScrollPosition {
  // Pixel scrollTop of the outer preview container. Used for markdown preview and
  // continuous-scroll (vertical) PDF mode.
  scrollTop?: number;
  // Current page number. Used for paginated (horizontal) PDF mode, where the container
  // itself doesn't scroll.
  page?: number;
}

export function getDocScrollPosition(key: string): DocScrollPosition | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as DocScrollPosition) : undefined;
  } catch {
    return undefined;
  }
}

export function saveDocScrollPosition(key: string, patch: DocScrollPosition) {
  try {
    const current = getDocScrollPosition(key) ?? {};
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Quota exceeded or storage disabled (e.g. private mode) — skip caching silently.
  }
}

/**
 * Sets `el.scrollTop` to `target`, retrying across animation frames until the
 * container has actually laid out enough scrollable content to reach it (or a
 * frame budget runs out). A single rAF after mount isn't enough for PDF pages —
 * they render lazily via pdf.js, so the container is often still short right
 * after mount, and a naive `scrollTop = target` silently clamps to 0.
 * Returns a cleanup function to cancel a pending retry (e.g. on unmount).
 */
export function restoreScrollTopWhenReady(el: HTMLElement, target: number, maxAttempts = 45): () => void {
  let cancelled = false;
  let raf = 0;

  const attempt = (attemptsLeft: number) => {
    if (cancelled) return;
    const canReach = el.scrollHeight - el.clientHeight >= target;
    if (canReach || attemptsLeft <= 0) {
      el.scrollTop = target;
      return;
    }
    raf = requestAnimationFrame(() => attempt(attemptsLeft - 1));
  };
  attempt(maxAttempts);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
