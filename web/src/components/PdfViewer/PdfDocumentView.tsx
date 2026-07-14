import { create } from "@bufbuild/protobuf";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MemoEditor from "@/components/MemoEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { extractAttachmentUidFromName } from "@/helpers/resource-names";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { PdfAnnotationSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { PdfAnnotationRect } from "./PdfAnnotationLayer";
import { PdfAnnotationSidebar } from "./PdfAnnotationSidebar";
import { PdfPages } from "./PdfPages";
import { PdfTextSidebar } from "./PdfTextSidebar";
import { PdfToolbar } from "./PdfToolbar";
import { usePdfAnnotations } from "./usePdfAnnotations";
import { usePdfExtractedText } from "./usePdfExtractedText";
import { usePdfViewerState } from "./usePdfViewerState";

// Which docked side panel is showing. Annotations (comments) and the plain-text view share the
// same slot and are mutually exclusive; null means the panel is closed.
type SidebarPanel = "annotations" | "text" | null;

interface Props {
  url: string;
  /** DOM node (typically a slot in a parent title bar) the toolbar is portaled into. */
  toolbarSlot: HTMLElement;
  className?: string;
  /** The memo this PDF is attached to. Annotation comments are anchored to it. Omit to disable annotations (e.g. no memo context available). */
  parentMemoName?: string;
  /** The attachment's resource name (attachments/{uid}), used to anchor annotations to this specific file. */
  attachmentName?: string;
  /** The attachment's filename, passed to the AI as a hint when formatting the extracted text. */
  filename?: string;
}

// Splits the PDF viewer into a toolbar (portaled into a caller-provided slot, e.g. a
// document title bar) and a pages area rendered inline — used by DocumentView so the
// page/zoom/orientation controls can sit next to the title instead of above the content.
export const PdfDocumentView = ({ url, toolbarSlot, className, parentMemoName, attachmentName, filename }: Props) => {
  const t = useTranslate();
  const state = usePdfViewerState(url);
  const isDesktop = useMediaQuery("lg");
  const [annotateMode, setAnnotateMode] = useState(true);
  const [selectedMemoName, setSelectedMemoName] = useState<string>();
  const [pendingAnnotation, setPendingAnnotation] = useState<{ page: number; rect: PdfAnnotationRect; text: string }>();
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const canAnnotate = !!parentMemoName && !!attachmentName;
  const { byPage, all, refetch } = usePdfAnnotations(parentMemoName, attachmentName);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const defaultOpenedRef = useRef(false);
  // Topmost page currently visible in continuous-scroll (vertical) mode, tracked only while
  // the text panel is open so the sidebar can follow along; unused in paginated (horizontal)
  // mode, where state.pageNumber is already an exact "current page."
  const [visiblePage, setVisiblePage] = useState<number | null>(null);
  // Docked-panel width in px. null keeps the CSS default (30% of the row); a drag on the
  // left-edge handle switches to an explicit px width, clamped to a sane range.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const sidebarWrapperRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWrapperRef.current?.getBoundingClientRect().width ?? 0;
    const onMove = (ev: MouseEvent) => {
      // Dragging left (clientX decreasing) widens the right-docked panel.
      const next = startWidth + (startX - ev.clientX);
      setSidebarWidth(Math.min(Math.max(next, 240), window.innerWidth * 0.7));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
  };

  // Extract + AI-format the text only once the text panel has been opened, reusing the
  // already-loaded pdf.js document so no second fetch/parse is needed.
  const textResult = usePdfExtractedText({
    uid: attachmentName ? extractAttachmentUidFromName(attachmentName) : "",
    url,
    filename: filename ?? "",
    doc: state.doc,
    numPages: state.numPages,
    enabled: activePanel === "text" && !!state.doc && state.numPages > 0,
  });

  const registerPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(page, el);
    else pageRefs.current.delete(page);
  }, []);

  // Tracks which PDF page is topmost-visible while the text panel is open, so it can scroll
  // to the matching block. Only runs in continuous-scroll mode and only while the panel is
  // visible (opening it later re-runs this effect since pageRefs are already populated by
  // then — page wrappers mount as soon as the doc loads, not lazily).
  useEffect(() => {
    if (activePanel !== "text" || state.orientation !== "vertical") return;
    const root = state.containerRef.current;
    if (!root || pageRefs.current.size === 0) return;
    const pageByEl = new Map<Element, number>();
    pageRefs.current.forEach((el, page) => pageByEl.set(el, page));
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { page: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = pageByEl.get(entry.target);
          if (page === undefined) continue;
          if (!best || entry.intersectionRatio > best.ratio) best = { page, ratio: entry.intersectionRatio };
        }
        if (best) setVisiblePage(best.page);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activePanel, state.orientation, state.numPages, state.containerRef]);

  const currentTextPage = state.orientation === "horizontal" ? state.pageNumber : visiblePage;

  // Open the comments panel by default when the PDF already has notes, so they're
  // visible on arrival instead of requiring the reader to discover the toggle button.
  // Only does this once per mount (not every time `all` changes), so it doesn't fight
  // a reader who's deliberately closed the panel.
  useEffect(() => {
    if (defaultOpenedRef.current || all.length === 0) return;
    defaultOpenedRef.current = true;
    setActivePanel("annotations");
  }, [all.length]);

  // Jumps to the page an annotation lives on. In paginated (horizontal) mode that means
  // flipping pages; in continuous scroll (vertical) mode it scrolls that page's wrapper
  // into view (sized ahead of render via basePageWidth/Height so the target is accurate
  // even if the page hasn't rendered yet — see PdfPageCanvas's `estimatedWidth/Height`).
  // Uses an instant jump rather than `behavior: "smooth"`: pages between the current
  // scroll position and the target lazy-render as the animation passes over them, and
  // each one swapping from its estimated placeholder size to its real measured size
  // mid-flight shifts the scroll target, which killed the in-progress smooth scroll
  // partway (a single click looked like it needed a second click to "finish").
  const jumpToPage = (page: number) => {
    if (state.orientation === "horizontal") {
      const target = page - ((page - 1) % Math.max(state.pagesPerView, 1));
      if (target !== state.pageNumber) {
        const diff = target - state.pageNumber;
        if (diff > 0) for (let i = 0; i < diff; i += state.pagesPerView) state.goNext();
        else for (let i = 0; i > diff; i -= state.pagesPerView) state.goPrev();
      }
      return;
    }
    pageRefs.current.get(page)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  if (state.error) {
    return <div className={cn("w-full p-6 text-center text-sm text-destructive", className)}>{t("pdf.load-failed")}</div>;
  }

  // Content of whichever panel is docked/open. `onClose` is wired only on desktop (the mobile
  // Sheet has its own dismiss); on mobile, selecting an entry closes the sheet before jumping.
  const renderPanel = (forDesktop: boolean) =>
    activePanel === "text" ? (
      <PdfTextSidebar
        className={forDesktop ? undefined : "w-full max-w-full border-l-0 border-t-0"}
        blocks={textResult.blocks}
        formatting={textResult.formatting}
        error={textResult.error}
        activePage={currentTextPage}
        onClose={forDesktop ? () => setActivePanel(null) : undefined}
        onSelect={(page) => {
          if (!forDesktop) setActivePanel(null);
          jumpToPage(page);
        }}
      />
    ) : (
      <PdfAnnotationSidebar
        className={forDesktop ? undefined : "w-full max-w-full border-l-0 border-t-0"}
        annotations={all}
        selectedMemoName={selectedMemoName}
        onClose={forDesktop ? () => setActivePanel(null) : undefined}
        onEdited={refetch}
        onSelect={(memoName, page) => {
          setSelectedMemoName(memoName);
          if (!forDesktop) setActivePanel(null);
          jumpToPage(page);
        }}
      />
    );

  return (
    <>
      {createPortal(
        <PdfToolbar
          orientation={state.orientation}
          pageNumber={state.pageNumber}
          numPages={state.numPages}
          pagesPerView={state.pagesPerView}
          scale={state.scale}
          loading={state.loading}
          canGoPrev={state.canGoPrev}
          canGoNext={state.canGoNext}
          canZoomOut={state.canZoomOut}
          canZoomIn={state.canZoomIn}
          onToggleOrientation={state.toggleOrientation}
          onPrev={state.goPrev}
          onNext={state.goNext}
          onZoomOut={state.zoomOut}
          onZoomIn={state.zoomIn}
          annotateMode={canAnnotate ? annotateMode : undefined}
          onToggleAnnotateMode={canAnnotate ? () => setAnnotateMode((v) => !v) : undefined}
          sidebarOpen={canAnnotate ? activePanel === "annotations" : undefined}
          onToggleSidebar={canAnnotate ? () => setActivePanel((p) => (p === "annotations" ? null : "annotations")) : undefined}
          textOpen={activePanel === "text"}
          onToggleText={() => setActivePanel((p) => (p === "text" ? null : "text"))}
        />,
        toolbarSlot,
      )}
      <div className="w-full flex items-start">
        <PdfPages
          doc={state.doc}
          numPages={state.numPages}
          pageNumber={state.pageNumber}
          scale={state.scale}
          orientation={state.orientation}
          pagesPerView={state.pagesPerView}
          containerRef={state.containerRef}
          className={cn("min-w-0 flex-1", className)}
          annotationsByPage={byPage}
          selectedAnnotationMemoName={selectedMemoName}
          annotateMode={canAnnotate && annotateMode}
          onAnnotationSelect={(memoName) => {
            setSelectedMemoName(memoName);
            setActivePanel("annotations");
          }}
          onAnnotationCreate={canAnnotate ? (page, rect, text) => setPendingAnnotation({ page, rect, text }) : undefined}
          basePageWidth={state.basePageWidth}
          basePageHeight={state.basePageHeight}
          onWrapperRef={registerPageRef}
        />
        {activePanel !== null && isDesktop && (
          // Sticky (not part of the page stack's own height) so it stays docked to the
          // right edge of whichever ancestor scrolls, like Adobe's comments panel, instead
          // of stretching the row or getting pushed around as notes/pages accumulate.
          // The width lives here (not on the sidebar itself): the sidebar uses w-full, and
          // a percentage width on a child of this auto-width sticky wrapper would resolve
          // circularly and blow up to content width.
          <div
            ref={sidebarWrapperRef}
            style={sidebarWidth != null ? { width: `${sidebarWidth}px` } : undefined}
            className="relative sticky top-0 h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] w-[30%] min-w-[240px] shrink-0"
          >
            {/* Left-edge drag handle: centered on the border, widened hover hit area. */}
            <div
              onMouseDown={startResize}
              className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-primary/40"
            />
            {renderPanel(true)}
          </div>
        )}
      </div>
      {activePanel !== null && !isDesktop && (
        <Sheet open onOpenChange={(open) => !open && setActivePanel(null)}>
          <SheetContent side="right" className="w-[85%] max-w-full overflow-y-auto px-2 py-3 bg-background">
            <SheetHeader>
              <SheetTitle>{t(activePanel === "text" ? "pdf.plain-text-view" : "pdf.annotations")}</SheetTitle>
            </SheetHeader>
            {renderPanel(false)}
          </SheetContent>
        </Sheet>
      )}
      {pendingAnnotation && parentMemoName && attachmentName && (
        <Dialog open onOpenChange={(open) => !open && setPendingAnnotation(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("pdf.add-annotation")}</DialogTitle>
            </DialogHeader>
            <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground line-clamp-4">
              {pendingAnnotation.text}
            </blockquote>
            <MemoEditor
              autoFocus
              parentMemoName={parentMemoName}
              pdfAnnotation={create(PdfAnnotationSchema, {
                attachmentName,
                page: pendingAnnotation.page,
                x: pendingAnnotation.rect.x,
                y: pendingAnnotation.rect.y,
                width: pendingAnnotation.rect.width,
                height: pendingAnnotation.rect.height,
                textSnippet: pendingAnnotation.text,
              })}
              onConfirm={(memoName) => {
                setPendingAnnotation(undefined);
                setSelectedMemoName(memoName);
                setActivePanel("annotations");
                refetch();
              }}
              onCancel={() => setPendingAnnotation(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
