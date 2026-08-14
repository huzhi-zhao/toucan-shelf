export const CACHE_DEBOUNCE_DELAY = 500;

// Browser setTimeout ids are numbers; don't infer the type, or @types/node in
// the CI toolchain turns it into NodeJS.Timeout and the assignment fails.
const pendingSaves = new Map<string, number>();
const STRUCTURED_CACHE_ENTRY_KIND = "memos.editor-cache";
const STRUCTURED_CACHE_ENTRY_VERSION = 1;

// Drafts expire an hour after they were last written, so a stale cache never
// resurrects content the user has long since moved on from.
export const CACHE_TTL_MS = 60 * 60 * 1000;

// Returns undefined when the entry is expired (caller should drop it).
function deserializeContent(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; version?: unknown; content?: unknown; savedAt?: unknown };
    if (
      parsed.kind === STRUCTURED_CACHE_ENTRY_KIND &&
      parsed.version === STRUCTURED_CACHE_ENTRY_VERSION &&
      typeof parsed.content === "string"
    ) {
      if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > CACHE_TTL_MS) {
        return undefined;
      }
      return parsed.content;
    }
  } catch {
    // Drafts have historically been stored as raw markdown strings.
  }

  return raw;
}

function writeEntry(key: string, content: string): void {
  if (content.trim()) {
    localStorage.setItem(
      key,
      JSON.stringify({
        kind: STRUCTURED_CACHE_ENTRY_KIND,
        version: STRUCTURED_CACHE_ENTRY_VERSION,
        content,
        savedAt: Date.now(),
      }),
    );
  } else {
    localStorage.removeItem(key);
  }
}

export const cacheService = {
  key: (username: string, cacheKey?: string): string => {
    return `${username}-${cacheKey || ""}`;
  },

  save: (key: string, content: string) => {
    const pendingSave = pendingSaves.get(key);
    if (pendingSave) {
      window.clearTimeout(pendingSave);
    }

    const timeoutId = window.setTimeout(() => {
      pendingSaves.delete(key);

      writeEntry(key, content);
    }, CACHE_DEBOUNCE_DELAY);

    pendingSaves.set(key, timeoutId);
  },

  saveNow: (key: string, content: string) => {
    const pendingSave = pendingSaves.get(key);
    if (pendingSave) {
      window.clearTimeout(pendingSave);
      pendingSaves.delete(key);
    }

    writeEntry(key, content);
  },

  load(key: string): string {
    const raw = localStorage.getItem(key);
    if (!raw) return "";

    const content = deserializeContent(raw);
    if (content === undefined) {
      this.clear(key);
      return "";
    }
    return content;
  },

  // Drops any draft scoped to a memo, regardless of which editor wrote it
  // (inline, notebook, ...). Used when the memo content is mutated outside the
  // editor — e.g. toggling a checkbox or editing a calendar event in preview —
  // so the stale draft does not overwrite the change on the next edit.
  clearForMemo(memoName: string): void {
    if (!memoName) return;

    const suffix = `-${memoName}`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith(suffix)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      this.clear(key);
    }
  },

  clear(key: string): void {
    const pendingSave = pendingSaves.get(key);
    if (pendingSave) {
      window.clearTimeout(pendingSave);
      pendingSaves.delete(key);
    }

    localStorage.removeItem(key);
  },

  clearAll(): void {
    for (const timeoutId of pendingSaves.values()) {
      window.clearTimeout(timeoutId);
    }
    pendingSaves.clear();
  },
};
