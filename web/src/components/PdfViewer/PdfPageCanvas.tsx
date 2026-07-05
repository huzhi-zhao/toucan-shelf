import type * as PdfJs from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

interface Props {
  doc: PdfJs.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Defer rendering until the canvas scrolls near the viewport (used in continuous vertical scroll mode). */
  lazy?: boolean;
  className?: string;
}

export const PdfPageCanvas = ({ doc, pageNumber, scale, lazy, className }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!lazy);

  useEffect(() => {
    if (!lazy || shouldRender) return;
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazy, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderTask: ReturnType<PdfJs.PDFPageProxy["render"]> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const cssViewport = page.getViewport({ scale });
      const context = canvas.getContext("2d");
      if (!context) return;

      // Render at devicePixelRatio resolution and downscale via CSS — otherwise on
      // high-DPI (retina) displays the canvas's backing store has fewer pixels than
      // the screen, and the browser upscales it, blurring the text.
      const outputScale = window.devicePixelRatio || 1;
      const renderViewport = page.getViewport({ scale: scale * outputScale });
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;

      renderTask = page.render({ canvasContext: context, viewport: renderViewport });
      try {
        await renderTask.promise;
      } catch (err) {
        // A superseded render (page/scale changed mid-render) throws a RenderingCancelledException;
        // that's expected churn, not a real error.
        if (!(err instanceof Error && err.name === "RenderingCancelledException")) throw err;
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, shouldRender]);

  return (
    <div ref={wrapperRef} className={className}>
      <canvas ref={canvasRef} className="dark:brightness-90 dark:invert-[0.93] dark:hue-rotate-180" />
    </div>
  );
};
