import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { PdfPages } from "./PdfPages";
import { PdfToolbar } from "./PdfToolbar";
import { usePdfViewerState } from "./usePdfViewerState";

interface Props {
  url: string;
  /** DOM node (typically a slot in a parent title bar) the toolbar is portaled into. */
  toolbarSlot: HTMLElement;
  className?: string;
}

// Splits the PDF viewer into a toolbar (portaled into a caller-provided slot, e.g. a
// document title bar) and a pages area rendered inline — used by DocumentView so the
// page/zoom/orientation controls can sit next to the title instead of above the content.
export const PdfDocumentView = ({ url, toolbarSlot, className }: Props) => {
  const t = useTranslate();
  const state = usePdfViewerState(url);

  if (state.error) {
    return <div className={cn("w-full p-6 text-center text-sm text-destructive", className)}>{t("pdf.load-failed")}</div>;
  }

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
        />,
        toolbarSlot,
      )}
      <PdfPages
        doc={state.doc}
        numPages={state.numPages}
        pageNumber={state.pageNumber}
        scale={state.scale}
        orientation={state.orientation}
        pagesPerView={state.pagesPerView}
        containerRef={state.containerRef}
        className={className}
      />
    </>
  );
};
