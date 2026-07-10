import type * as PdfJs from "pdfjs-dist";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import "pdfjs-dist/web/pdf_viewer.css";

// Minimal IPDFLinkService: we only need external/URL links to open in a new tab.
// AnnotationLayer calls `addLinkAttributes` itself to turn each link annotation into
// an <a> with an href — it's not done automatically, so this must set href/target/rel.
// In-document navigation (goToDestination, page jumps, etc.) is not supported since
// this viewer doesn't expose a "jump to page" API to annotations.
const linkService = {
  externalLinkEnabled: true,
  externalLinkTarget: 2, // LinkTarget.BLANK
  externalLinkRel: "noopener noreferrer",
  addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow = false) {
    link.href = link.title = url;
    link.target = newWindow || linkService.externalLinkTarget === 2 ? "_blank" : "";
    link.rel = linkService.externalLinkRel;
  },
  getDestinationHash: () => "#",
  getAnchorUrl: () => "#",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

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
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
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

      // pdf.js's text/annotation layer CSS (pdf_viewer.css) sizes and positions everything
      // via `calc(var(--scale-factor) * ...)`. It's normally set by pdf.js's own PDFViewer
      // wrapper (class "pdfViewer"), which we don't use here, so without this the calc()
      // is invalid, the layers collapse to zero size, and every annotation/text span
      // (positioned as a % of that zero-size container) becomes unclickable/invisible.
      wrapperRef.current?.style.setProperty("--scale-factor", String(scale));

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
      if (cancelled) return;

      const textLayerEl = textLayerRef.current;
      if (textLayerEl) {
        textLayerEl.innerHTML = "";
        textLayerEl.style.width = `${cssViewport.width}px`;
        textLayerEl.style.height = `${cssViewport.height}px`;
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerEl, viewport: cssViewport });
        await textLayer.render();
      }

      const annotationLayerEl = annotationLayerRef.current;
      if (annotationLayerEl) {
        annotationLayerEl.innerHTML = "";
        annotationLayerEl.style.width = `${cssViewport.width}px`;
        annotationLayerEl.style.height = `${cssViewport.height}px`;
        const annotations = await page.getAnnotations();
        if (cancelled) return;
        new AnnotationLayer({
          div: annotationLayerEl,
          page,
          viewport: cssViewport.clone({ dontFlip: true }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any).render({
          viewport: cssViewport.clone({ dontFlip: true }),
          div: annotationLayerEl,
          annotations,
          page,
          linkService,
          renderForms: false,
        });
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, shouldRender]);

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <canvas ref={canvasRef} className="dark:brightness-90 dark:invert-[0.93] dark:hue-rotate-180" />
      <div ref={textLayerRef} className="textLayer absolute top-0 left-0" />
      <div ref={annotationLayerRef} className="annotationLayer absolute top-0 left-0" />
    </div>
  );
};
