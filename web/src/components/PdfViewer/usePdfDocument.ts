import type * as PdfJs from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

// pdf.js is dynamically imported (and its worker resolved via a Vite-friendly `import.meta.url`
// URL) so the ~1-2MB library is only ever loaded when a PDF document is actually rendered.
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs;
}

export function usePdfDocument(url: string) {
  const docRef = useRef<PdfJs.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNumPages(0);
    docRef.current = null;

    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  return { docRef, numPages, loading, error };
}
