import type React from "react";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";

export interface MemoContentProps {
  content: string;
  /** Resource name of the memo (e.g. `memos/abc123`). Enables footnote links to target the memo detail page. */
  memoName?: string;
  compact?: boolean;
  /** Renders `content` as a sandboxed HTML preview instead of markdown (memo.docType === HTML). */
  isHtml?: boolean;
  /** Renders the memo's linked PDF instead of markdown (memo.docType === PDF). */
  isPdf?: boolean;
  /** Display title for the PDF card/viewer (memo.title). */
  pdfTitle?: string;
  /** File URL of the linked PDF attachment. */
  pdfUrl?: string;
  /** The linked PDF attachment, for file size/date metadata on the compact card. */
  pdfAttachment?: Attachment;
  /** Render the full inline PdfViewer (memo detail page) instead of the compact PdfDocCard (lists). */
  pdfDetailView?: boolean;
  /** Fold content taller than the trigger height, regardless of the `compact` display setting. Opt-in per caller (e.g. Explore). */
  autoFold?: boolean;
  /** Never fold, even if the rendered content exceeds the fold trigger height (e.g. pinned memos). */
  alwaysExpanded?: boolean;
  className?: string;
  contentClassName?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export type ContentCompactView = "ALL" | "SNIPPET";
