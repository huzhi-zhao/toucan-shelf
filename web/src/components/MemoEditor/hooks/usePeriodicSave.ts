import { useCallback, useEffect, useRef } from "react";
import { useLocalStorage } from "@/hooks";
import { PERIODIC_SAVE_STORAGE_KEY } from "../constants";

/**
 * How often an opted-in editor commits the document to the server while the
 * user keeps typing. 30s is the middle of the range other editors use
 * (WordPress autosaves every 60s, Confluence every 30s, Google Docs saves
 * continuously) — short enough that a crash costs at most half a minute of
 * work, long enough to keep the write volume low on long editing sessions.
 */
export const PERIODIC_SAVE_INTERVAL_MS = 30 * 1000;

/**
 * Periodically commits the memo to the server while it is being edited — the
 * opt-in "auto-save" toggle next to the Save button.
 *
 * Distinct from `useAutoSave`, which only mirrors the draft into localStorage:
 * this one performs a real save, so it is off by default and only enabled for
 * editors of an already-existing memo (never for memo creation).
 */
export const usePeriodicSave = ({ enabled, save }: { enabled: boolean; save: () => Promise<void> }) => {
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;

    // Guards against overlapping runs: a slow save (large upload, sluggish
    // network) must not have a second tick fire on top of it.
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void saveRef.current().finally(() => {
        inFlight = false;
      });
    };

    const intervalId = window.setInterval(run, PERIODIC_SAVE_INTERVAL_MS);
    // Hiding the tab is the last moment we're guaranteed to run before it may
    // be closed, so flush there too instead of waiting out the interval.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        run();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
};

/**
 * Reads/writes the per-document opt-in for periodic saving.
 *
 * Scoped to a single memo on purpose: a global toggle meant that turning
 * auto-save on once left it on for every document opened afterwards, so an
 * accidental edit (a stray cut/paste) in an unrelated document could be
 * committed without the user ever pressing Save.
 */
export const usePeriodicSavePreference = (memoName: string | undefined) => {
  const [enabledDocs, setEnabledDocs] = useLocalStorage<Record<string, boolean>>(PERIODIC_SAVE_STORAGE_KEY, {});
  const enabled = Boolean(memoName && enabledDocs?.[memoName]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (!memoName) return;
      setEnabledDocs((current) => {
        const docs = { ...(current ?? {}) };
        if (next) {
          docs[memoName] = true;
        } else {
          delete docs[memoName];
        }
        return docs;
      });
    },
    [memoName, setEnabledDocs],
  );

  return [enabled, setEnabled] as const;
};
