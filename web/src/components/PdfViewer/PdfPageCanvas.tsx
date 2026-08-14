import type * as PdfJs from "pdfjs-dist";
import { AnnotationLayer, TextLayer } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DocMark, DocMarkLayer } from "@/components/DocComments/DocMarkLayer";
import { buildTextQuote, MARK_LAYER_ATTR, type TextQuote } from "@/components/DocComments/textAnchor";
import { MARK_TOOLBAR_ATTR, MarkToolbar } from "@/components/MarkToolbar";
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
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js does not export the IPDFLinkService interface
} as any;

/** How a mark looks: a background fill in `color` ("" = none) and/or an underline. */
export interface PdfMarkStyle {
  color: string;
  underline: boolean;
}

/** A finished text selection on this page, in both anchoring forms. */
export interface PdfSelectionPayload {
  /** Normalized (0~1) bounding box of the selection, kept as the fallback anchor. */
  rect: PdfAnnotationRect;
  /** The selected text, shown as the note's quoted context. */
  text: string;
  /**
   * The quote selector for the selection, which is what the mark is actually drawn from.
   * Undefined only if the selection covered no walkable text — in practice unreachable,
   * since a selection implies a text layer, but the rect anchor covers it either way.
   */
  quote?: TextQuote;
}

interface Props {
  doc: PdfJs.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Defer rendering until the canvas scrolls near the viewport (used in continuous vertical scroll mode). */
  lazy?: boolean;
  className?: string;
  annotations?: PdfAnnotationEntry[];
  selectedAnnotationMemoName?: string;
  /** When true, selecting text in this page's text layer surfaces the mark toolbar, and
   *  existing marks can be clicked to restyle them. */
  annotateMode?: boolean;
  onAnnotationSelect?: (memoName: string) => void;
  /** Create a bare mark (no note) over the selection, straight from the toolbar. */
  onMarkCreate?: (selection: PdfSelectionPayload, style: PdfMarkStyle) => void;
  /** Open the note composer for the selection. */
  onNoteCreate?: (selection: PdfSelectionPayload) => void;
  /** Restyle an existing mark in place. */
  onMarkRestyle?: (memoName: string, style: PdfMarkStyle) => void;
  /** Remove an existing mark's styling (or the whole annotation, when it carries no note). */
  onMarkClear?: (memoName: string) => void;
  /** Write (or continue writing) the note carried by an existing mark. */
  onMarkNote?: (memoName: string) => void;
  /** CSS px size to reserve before this page has actually rendered (see `lazy`), so
   *  jumping to an off-screen page can compute an accurate scroll target instead of
   *  landing on the browser's default zero/300x150 canvas box. Approximate is fine —
   *  it's replaced by the real measured size once rendering completes. */
  estimatedWidth?: number;
  estimatedHeight?: number;
  /** Reports this page's wrapper element so a scroll-to-page can find it without
   *  waiting for the page to have rendered. */
  onWrapperRef?: (pageNumber: number, el: HTMLDivElement | null) => void;
  /** When provided, the page-number badge becomes a button that jumps the plain-text panel to this page. */
  onPageNumberClick?: (pageNumber: number) => void;
}

/** A pending selection plus where to float its toolbar (wrapper-relative px). */
interface PendingSelection extends PdfSelectionPayload {
  point: { x: number; y: number };
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
  onMarkCreate,
  onNoteCreate,
  onMarkRestyle,
  onMarkClear,
  onMarkNote,
  estimatedWidth,
  estimatedHeight,
  onWrapperRef,
  onPageNumberClick,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!lazy);
  const [rendered, setRendered] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  // The existing mark whose toolbar is open, plus where it was clicked. The clicked point is
  // only a first guess: `markAnchors` replaces it once the layer has remeasured (a zoom or a
  // sidebar resize reflows the text under the toolbar).
  const [activeMark, setActiveMark] = useState<{ memoName: string; x: number; y: number } | null>(null);
  const [markAnchors, setMarkAnchors] = useState<Record<string, { x: number; y: number }>>({});

  // Annotations split by which anchor they can be drawn from. Text-anchored ones become marks
  // painted over the words themselves; the rest keep the old box over the region they cover —
  // the only thing possible for a scanned page, which has no text layer to anchor into.
  const marks = useMemo<DocMark[]>(
    () =>
      (annotations ?? []).flatMap((entry) =>
        entry.quote ? [{ memoName: entry.memo.name, quote: entry.quote, color: entry.color, underline: entry.underline }] : [],
      ),
    [annotations],
  );
  const rectAnnotations = useMemo(() => (annotations ?? []).filter((entry) => !entry.quote), [annotations]);
  const activeMarkEntry = useMemo(
    () => (annotations ?? []).find((entry) => entry.memo.name === activeMark?.memoName),
    [annotations, activeMark],
  );

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
          // biome-ignore lint/suspicious/noExplicitAny: AnnotationLayer's constructor options are untyped in this pdf.js build
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

  // Leaving annotate mode packs away both toolbars.
  useEffect(() => {
    if (annotateMode) return;
    setPendingSelection(null);
    setActiveMark(null);
  }, [annotateMode]);

  const clearSelection = () => window.getSelection()?.removeAllRanges();

  // On mouse-up in the page, if text was selected, capture it *now* (before focus moves to the
  // toolbar and collapses it) in both anchoring forms — a quote selector over the text layer,
  // which is what the mark is drawn from, plus a normalized bounding box as the fallback — and
  // float the mark toolbar over the selection.
  //
  // This mirrors DocumentView's handler rather than listening for `selectionchange`, which
  // fires continuously mid-drag and would have the toolbar chasing the cursor.
  const handleMouseUp = (event: React.MouseEvent) => {
    if (!annotateMode) return;
    // A mouse-up on an existing mark is that mark's own click, and one inside the toolbar must
    // not dismiss it before the click reaches the button being pressed (the toolbar prevents
    // its mouse-down to keep the selection alive, but mouse-up still bubbles).
    if (event.target instanceof Element && event.target.closest(`[${MARK_LAYER_ATTR}], [${MARK_TOOLBAR_ATTR}]`)) return;
    const wrapper = wrapperRef.current;
    const textLayerEl = textLayerRef.current;
    const selection = window.getSelection();
    if (!wrapper || !textLayerEl) return;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim()) {
      // A plain click on the page dismisses whatever the previous one opened.
      setPendingSelection(null);
      setActiveMark(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!textLayerEl.contains(range.commonAncestorContainer)) {
      setPendingSelection(null);
      return;
    }
    const text = selection.toString().trim();
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
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
    setActiveMark(null);
    setPendingSelection({
      rect: {
        x: (left - wrapperRect.left) / wrapperRect.width,
        y: (top - wrapperRect.top) / wrapperRect.height,
        width: (right - left) / wrapperRect.width,
        height: (bottom - top) / wrapperRect.height,
      },
      text,
      // Anchored against the text layer, not the wrapper: the wrapper also contains the canvas
      // and the overlay layers, whose text (the page-number badge) is not page content.
      quote: buildTextQuote(textLayerEl, range),
      point: { x: (left + right) / 2 - wrapperRect.left, y: top - wrapperRect.top },
    });
  };

  // Clicking a mark floats the toolbar over it, so it can be recoloured or erased in place —
  // without this, a bare mark, which has no sidebar card of its own, could never be undone.
  // A mark that carries a note also selects it, opening the sidebar on that note; a bare mark
  // deliberately does not, since the panel filters bare marks out and would open on nothing.
  const handleMarkClick = useCallback(
    (memoName: string, point: { x: number; y: number }) => {
      setPendingSelection(null);
      setActiveMark({ memoName, ...point });
      const entry = (annotations ?? []).find((a) => a.memo.name === memoName);
      if (entry?.memo.content.trim()) onAnnotationSelect?.(memoName);
    },
    [annotations, onAnnotationSelect],
  );

  const applyToSelection = (style: PdfMarkStyle) => {
    if (!pendingSelection) return;
    const { point: _point, ...payload } = pendingSelection;
    setPendingSelection(null);
    // The toolbar deliberately keeps the selection alive while open; once the mark exists,
    // drop it so the browser stops painting it over the new mark.
    clearSelection();
    onMarkCreate?.(payload, style);
  };

  return (
    <div
      ref={wrapperRef}
      className={cn("relative", className)}
      style={!rendered && estimatedWidth && estimatedHeight ? { width: estimatedWidth, height: estimatedHeight } : undefined}
      onMouseUp={handleMouseUp}
    >
      <canvas ref={canvasRef} className="dark:brightness-90 dark:invert-[0.93] dark:hue-rotate-180" />
      <div ref={textLayerRef} className="textLayer absolute top-0 left-0" />
      <div ref={annotationLayerRef} className="annotationLayer absolute top-0 left-0" />
      {/* Marks resolve against the text layer but are drawn as a sibling of it, not a child:
          each re-render wipes the text layer with innerHTML="", which would take React's
          nodes with it. The two elements share an origin and size, so the rects still line up. */}
      <DocMarkLayer
        containerRef={textLayerRef}
        marks={marks}
        // Re-measure once the text layer exists, and again whenever zooming rebuilds it.
        contentKey={`${scale}:${rendered}`}
        selectedMemoName={selectedAnnotationMemoName}
        onMarkClick={annotateMode ? handleMarkClick : undefined}
        onAnchors={setMarkAnchors}
      />
      {rectAnnotations.length > 0 && (
        <PdfAnnotationLayer annotations={rectAnnotations} selectedMemoName={selectedAnnotationMemoName} onSelect={onAnnotationSelect} />
      )}
      {onPageNumberClick ? (
        <button
          type="button"
          title={pageNumber.toString()}
          className="absolute bottom-4 right-5 text-[10px] leading-tight text-gray-300 tabular-nums select-none hover:text-blue-500 hover:underline cursor-pointer"
          onClick={() => onPageNumberClick(pageNumber)}
        >
          {pageNumber}
        </button>
      ) : (
        <div className="absolute bottom-4 right-5 text-[10px] leading-tight text-gray-300 tabular-nums pointer-events-none select-none">
          {pageNumber}
        </div>
      )}
      {pendingSelection && (
        <MarkToolbar
          x={pendingSelection.point.x}
          y={pendingSelection.point.y}
          activeColorKey=""
          activeUnderline={false}
          onColor={(colorKey) => applyToSelection({ color: colorKey, underline: false })}
          onUnderline={() => applyToSelection({ color: "", underline: true })}
          onNote={() => {
            const { point: _point, ...payload } = pendingSelection;
            setPendingSelection(null);
            clearSelection();
            onNoteCreate?.(payload);
          }}
        />
      )}
      {activeMarkEntry && activeMark && (
        <MarkToolbar
          // The live anchor wins over the clicked point, which only covers the frame before the
          // layer's first remeasure.
          x={markAnchors[activeMark.memoName]?.x ?? activeMark.x}
          y={markAnchors[activeMark.memoName]?.y ?? activeMark.y}
          activeColorKey={activeMarkEntry.color}
          activeUnderline={activeMarkEntry.underline}
          // Re-picking the current colour is a no-op, not a toggle-off; erasing is the eraser's job.
          onColor={(colorKey) => {
            setActiveMark(null);
            onMarkRestyle?.(activeMark.memoName, { color: colorKey, underline: activeMarkEntry.underline });
          }}
          onUnderline={() => {
            setActiveMark(null);
            onMarkRestyle?.(activeMark.memoName, { color: activeMarkEntry.color, underline: !activeMarkEntry.underline });
          }}
          // A bare mark has no sidebar card of its own (the panel filters empty comments out), so
          // this must open a composer for it rather than assume the sidebar is already showing it —
          // otherwise the note button on a freshly-highlighted passage looks dead.
          onNote={() => {
            setActiveMark(null);
            onMarkNote?.(activeMark.memoName);
          }}
          onClear={() => {
            setActiveMark(null);
            onMarkClear?.(activeMark.memoName);
          }}
        />
      )}
    </div>
  );
};
