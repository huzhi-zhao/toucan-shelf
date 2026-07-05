import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { PdfPages } from "./PdfPages";
import { PdfToolbar } from "./PdfToolbar";
import { usePdfViewerState } from "./usePdfViewerState";

interface Props {
  url: string;
  className?: string;
}

export const PdfViewer = ({ url, className }: Props) => {
  const t = useTranslate();
  const state = usePdfViewerState(url);

  if (state.error) {
    return <div className={cn("w-full p-6 text-center text-sm text-destructive", className)}>{t("pdf.load-failed")}</div>;
  }

  return (
    <div className={cn("w-full flex flex-col gap-2", className)}>
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
        className="justify-center"
      />
      <PdfPages
        doc={state.doc}
        numPages={state.numPages}
        pageNumber={state.pageNumber}
        scale={state.scale}
        orientation={state.orientation}
        pagesPerView={state.pagesPerView}
        containerRef={state.containerRef}
      />
    </div>
  );
};
