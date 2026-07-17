import { MessageSquarePlusIcon } from "lucide-react";
import type * as PdfJs from "pdfjs-dist";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PdfAnnotationLayer, type PdfAnnotationRect } from "./PdfAnnotationLayer";
import type { PdfAnnotationEntry } from "./usePdfAnnotations";
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
  annotations?: PdfAnnotationEntry[];
  selectedAnnotationMemoName?: string;
  /** When true, selecting text in this page's text layer surfaces an "add note" button. */
  annotateMode?: boolean;
  onAnnotationSelect?: (memoName: string) => void;
  onAnnotationCreate?: (rect: PdfAnnotationRect, textSnippet: string) => void;
  /** CSS px size to reserve before this page has actually rendered (see `lazy`), so
   *  jumping to an off-screen page can compute an accurate scroll target instead of
   *  landing on the browser's default zero/300x150 canvas box. Approximate is fine —
   *  it's replaced by the real measured size once rendering completes. */
  estimatedWidth?: number;
  estimatedHeight?: number;
  /** Reports this page's wrapper element so a scroll-to-page can find it without
   *  waiting for the page to have rendered. */
  onWrapperRef?: (pageNumber: number, el: HTMLDivElement | null) => void;
}

interface PendingSelection {
  rect: PdfAnnotationRect;
  text: string;
}

export const PdfPageCanvas = ({
  doc,
  pageNumber,
  scale,
  lazy,
  className,
  annotations,
  selectedAnnotationMemoName,
  annotateMode,
  onAnnotationSelect,
  onAnnotationCreate,
  estimatedWidth,
  estimatedHeight,
  onWrapperRef,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!lazy);
  const [rendered, setRendered] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  useEffect(() => {
    onWrapperRef?.(pageNumber, wrapperRef.current);
    return () => onWrapperRef?.(pageNumber, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

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
      setRendered(true);
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, shouldRender]);

  // Surfaces an "add note" button once the user finishes selecting text within this
  // page's text layer, in annotate mode. The button's position/size (and the anchor
  // rect passed to onAnnotationCreate) come from the selection Range's client rects,
  // normalized against the page wrapper so they stay aligned across zoom/orientation.
  useEffect(() => {
    if (!annotateMode) {
      setPendingSelection(null);
      return;
    }
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const wrapper = wrapperRef.current;
      const textLayerEl = textLayerRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !wrapper || !textLayerEl) {
        setPendingSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!textLayerEl.contains(range.commonAncestorContainer)) {
        setPendingSelection(null);
        return;
      }
      const text = selection.toString().trim();
      const rects = Array.from(range.getClientRects());
      if (!text || rects.length === 0) {
        setPendingSelection(null);
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      if (wrapperRect.width === 0 || wrapperRect.height === 0) return;
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      setPendingSelection({
        rect: {
          x: (left - wrapperRect.left) / wrapperRect.width,
          y: (top - wrapperRect.top) / wrapperRect.height,
          width: (right - left) / wrapperRect.width,
          height: (bottom - top) / wrapperRect.height,
        },
        text,
      });
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [annotateMode]);

  return (
    <div
      ref={wrapperRef}
      className={cn("relative", className)}
      style={!rendered && estimatedWidth && estimatedHeight ? { width: estimatedWidth, height: estimatedHeight } : undefined}
    >
      <canvas ref={canvasRef} className="dark:brightness-90 dark:invert-[0.93] dark:hue-rotate-180" />
      <div ref={textLayerRef} className="textLayer absolute top-0 left-0" />
      <div ref={annotationLayerRef} className="annotationLayer absolute top-0 left-0" />
      {(annotations?.length || pendingSelection) && (
        <PdfAnnotationLayer annotations={annotations ?? []} selectedMemoName={selectedAnnotationMemoName} onSelect={onAnnotationSelect} />
      )}
      <div className="absolute bottom-1 right-1.5 rounded bg-black/40 px-1 text-[10px] leading-tight text-white/90 tabular-nums pointer-events-none select-none">
        {pageNumber}
      </div>
      {pendingSelection && (
        <Button
          size="sm"
          className="absolute -translate-y-full shadow-md"
          style={{ left: `${pendingSelection.rect.x * 100}%`, top: `${pendingSelection.rect.y * 100}%` }}
          onMouseDown={(e) => {
            // Prevent the button click from collapsing the selection before onClick fires.
            e.preventDefault();
          }}
          onClick={() => {
            onAnnotationCreate?.(pendingSelection.rect, pendingSelection.text);
            window.getSelection()?.removeAllRanges();
            setPendingSelection(null);
          }}
        >
          <MessageSquarePlusIcon className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
};
