import type { Book, NavItem } from "epubjs";
import { useEffect, useRef, useState } from "react";
import { withChunkReload } from "@/utils/dynamicImport";

// epub.js (+ its bundled jszip) is ~300KB, so it's dynamically imported and only ever
// pulled in when an EPUB is actually opened — mirroring how PdfViewer lazy-loads pdf.js.
async function loadEpubJs() {
  const mod = await withChunkReload(() => import("epubjs"));
  return mod.default;
}

export interface EpubBookState {
  bookRef: React.MutableRefObject<Book | null>;
  /** Flattened table of contents (spine reading order), populated once the book's navigation loads. */
  toc: NavItem[];
  loading: boolean;
  error: string | null;
}

// Fetches an EPUB attachment and parses it entirely in the browser. Returns the epub.js
// Book (via a ref, so re-renders don't churn the rendition) plus its table of contents.
export function useEpubBook(url: string): EpubBookState {
  const bookRef = useRef<Book | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setToc([]);
    bookRef.current = null;

    (async () => {
      try {
        const ePub = await loadEpubJs();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const book = ePub(data);
        bookRef.current = book;
        const nav = await book.loaded.navigation;
        if (cancelled) {
          book.destroy();
          return;
        }
        setToc(nav.toc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      bookRef.current?.destroy();
      bookRef.current = null;
    };
  }, [url]);

  return { bookRef, toc, loading, error };
}
