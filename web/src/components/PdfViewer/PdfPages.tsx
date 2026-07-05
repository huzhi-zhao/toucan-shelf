import type * as PdfJs from "pdfjs-dist";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { PdfPageCanvas } from "./PdfPageCanvas";
import type { PdfOrientation } from "./usePdfViewerState";

interface Props {
  doc: PdfJs.PDFDocumentProxy | null;
  numPages: number;
  pageNumber: number;
  scale: number;
  orientation: PdfOrientation;
  pagesPerView: number;
  containerRef: RefObject<HTMLDivElement | null>;
  className?: string;
}

export const PdfPages = ({ doc, numPages, pageNumber, scale, orientation, pagesPerView, containerRef, className }: Props) => {
  if (!doc) return <div ref={containerRef} className={className} />;

  if (orientation === "vertical") {
    return (
      <div ref={containerRef} className={cn("w-full flex flex-col items-center gap-4 overflow-y-auto", className)}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <PdfPageCanvas key={n} doc={doc} pageNumber={n} scale={scale} lazy />
        ))}
      </div>
    );
  }

  const pages = pagesPerView === 2 ? [pageNumber, pageNumber + 1].filter((n) => n <= numPages) : [pageNumber];
  return (
    <div ref={containerRef} className={cn("w-full flex items-start justify-center gap-4 overflow-x-auto", className)}>
      {pages.map((n) => (
        <PdfPageCanvas key={n} doc={doc} pageNumber={n} scale={scale} />
      ))}
    </div>
  );
};
