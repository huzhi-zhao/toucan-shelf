import { ArrowUpIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { EpubDocumentView } from "@/components/EpubViewer/EpubDocumentView";
import MemoContent from "@/components/MemoContent";
import {
  isEpubAttachment,
  isHtmlAttachment,
  isMarkdownAttachment,
  isPdfAttachment,
} from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { PdfDocumentView } from "@/components/PdfViewer/PdfDocumentView";
import { attachmentNamePrefix } from "@/helpers/resource-names";
import { useAttachment } from "@/hooks/useAttachmentQueries";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import {
  getDocScrollPosition,
  restoreScrollTopWhenReady,
  saveDocScrollPosition,
} from "@/utils/scrollPositionCache";

// Header hides once the user has scrolled down past this many px from their last
// direction change, and reappears as soon as they scroll back up.
const HEADER_HIDE_THRESHOLD = 60;
// The floating "back to top" button appears once scrolled past this many px.
const BACK_TO_TOP_THRESHOLD = 300;

// Standalone, unauthenticated-chrome page opened in a new tab to preview a PDF or
// HTML attachment without forcing a download. HTML runs in a sandboxed iframe:
// scripts only execute while the parent memo is still PRIVATE (creator-only, so the
// uploader is the only possible victim), and even then without allow-same-origin so
// the script can't reach the app's cookies/storage. Any shared memo (PROTECTED/PUBLIC)
// falls back to allow-same-origin-only so uploaded HTML can never execute for viewers.
const AttachmentPreview = () => {
  const t = useTranslate();
  const params = useParams();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const toolbarSlotRef = useCallback(
    (node: HTMLDivElement | null) => setToolbarSlot(node),
    [],
  );
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The element the EPUB reader scrolls internally (epub.js owns it), captured from onScroll so
  // the back-to-top button can scroll the right container. Null for PDF/HTML/markdown.
  const epubScrollerRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const hideAnchorRef = useRef(0);
  const saveScrollTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const name = params.uid ? `${attachmentNamePrefix}${params.uid}` : "";
  const {
    data: attachment,
    isLoading,
    error,
  } = useAttachment(name, { enabled: !!name });

  const isHtml = attachment ? isHtmlAttachment(attachment) : false;
  const isPdf = attachment ? isPdfAttachment(attachment) : false;
  const isEpub = attachment ? isEpubAttachment(attachment) : false;
  // Markdown is fetched as raw text like HTML is, but rendered through the same MemoContent
  // pipeline the notebook document page uses, so a .md attachment reads exactly like a document.
  const isMarkdown = attachment
    ? !isHtml && !isPdf && !isEpub && isMarkdownAttachment(attachment)
    : false;
  const cachedPosition = attachment
    ? getDocScrollPosition(attachment.name)
    : undefined;

  const isParentMemoQueryEnabled = !!attachment?.memo && isHtml;
  const { data: parentMemo, isPending: isParentMemoPending } = useMemoQuery(
    attachment?.memo ?? "",
    {
      enabled: isParentMemoQueryEnabled,
    },
  );
  // Scripts only run for HTML attachments on memos that are still PRIVATE (creator-only).
  // Anything shared (PROTECTED/PUBLIC) stays script-free to prevent stored XSS from
  // reaching other viewers. See AttachmentPreview iframe below.
  const isPrivate = parentMemo?.visibility === Visibility.PRIVATE;
  // A sandboxed iframe locks in its permissions at srcDoc navigation time, so we must
  // know isPrivate *before* first render — otherwise a later attribute change can't
  // retroactively grant/revoke script execution. Wait for the visibility check to settle.
  const isVisibilityResolved =
    !isParentMemoQueryEnabled || !isParentMemoPending;

  useEffect(() => {
    if (!attachment) {
      return;
    }
    const prevTitle = document.title;
    document.title = attachment.filename;
    return () => {
      document.title = prevTitle;
    };
  }, [attachment]);

  useEffect(() => {
    if (!attachment || (!isHtml && !isMarkdown)) {
      return;
    }
    let cancelled = false;
    fetch(getAttachmentUrl(attachment))
      .then((res) => {
        if (!res.ok) throw new Error("failed to fetch attachment");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (!cancelled) setTextError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, isHtml, isMarkdown]);

  // Show/hide the header and the back-to-top button from a scroll offset. Shared by the outer
  // container's scroll (PDF/markdown) and the EPUB reader's own internal scroll (bridged via
  // EpubDocumentView.onScroll), since epub.js scrolls a container this page can't observe.
  const applyScrollDirection = useCallback((scrollTop: number) => {
    setShowBackToTop(scrollTop > BACK_TO_TOP_THRESHOLD);
    if (scrollTop <= lastScrollTopRef.current) {
      // Scrolling up (or at the top): reveal the header immediately.
      setHeaderHidden(false);
      hideAnchorRef.current = scrollTop;
    } else if (scrollTop - hideAnchorRef.current > HEADER_HIDE_THRESHOLD) {
      setHeaderHidden(true);
    }
    lastScrollTopRef.current = scrollTop;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    applyScrollDirection(scrollTop);

    if (isPdf && attachment) {
      clearTimeout(saveScrollTimeoutRef.current);
      saveScrollTimeoutRef.current = setTimeout(
        () => saveDocScrollPosition(attachment.name, { scrollTop }),
        300,
      );
    }
  }, [isPdf, attachment, applyScrollDirection]);

  // Restore the last scroll position (continuous-scroll PDF mode) once the page's
  // reserved layout has settled. Paginated mode is restored separately via
  // `initialPageNumber` below, since that container doesn't scroll.
  useEffect(() => {
    if (!isPdf || !attachment || cachedPosition?.scrollTop == null) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    return restoreScrollTopWhenReady(el, cachedPosition.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPdf, attachment?.name]);

  const scrollToTop = useCallback(() => {
    const target = epubScrollerRef.current ?? scrollContainerRef.current;
    target?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Up/down arrow keys scroll the active reading container by a fixed 1/3 of the viewport
  // (a page-like jump, like dragging a scrollbar) instead of the browser's single-line
  // native arrow scroll. Only fires while the content is actually vertically scrollable,
  // and is ignored while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

      const el = epubScrollerRef.current ?? scrollContainerRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;

      e.preventDefault();
      const delta = el.clientHeight / 3;
      el.scrollBy({
        top: e.key === "ArrowDown" ? delta : -delta,
        behavior: "auto",
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">
        {t("pdf.loading")}
      </div>
    );
  }

  if (error || !attachment || (!isPdf && !isHtml && !isEpub && !isMarkdown)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-destructive">
        {t("attachment-preview.unavailable")}
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      {!isHtml && (
        // The header sits in normal flow (not absolute) and collapses its height as it hides, so
        // the scroll area below grows to fill the reclaimed space instead of leaving a blank strip.
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border bg-background px-4 transition-all duration-300",
            headerHidden ? "h-0 border-b-0" : "h-11 py-2",
          )}
        >
          <span
            className="truncate text-sm font-medium text-foreground"
            title={attachment.filename}
          >
            {attachment.filename}
          </span>
          <div
            ref={toolbarSlotRef}
            className="flex shrink-0 items-center gap-1"
          />
        </div>
      )}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {isPdf && toolbarSlot && (
          <PdfDocumentView
            url={getAttachmentUrl(attachment)}
            toolbarSlot={toolbarSlot}
            className="px-6 py-4"
            parentMemoName={attachment.memo}
            attachmentName={attachment.name}
            filename={attachment.filename}
            initialPageNumber={cachedPosition?.page}
            onPageNumberChange={(page) =>
              saveDocScrollPosition(attachment.name, { page })
            }
          />
        )}
        {isEpub && toolbarSlot && (
          <EpubDocumentView
            key={attachment.name}
            url={getAttachmentUrl(attachment)}
            toolbarSlot={toolbarSlot}
            className="px-6 py-4"
            parentMemoName={attachment.memo}
            attachmentName={attachment.name}
            initialReaderSettings={attachment.readerSettings}
            initialCfi={cachedPosition?.cfi}
            onLocationChange={(cfi) =>
              saveDocScrollPosition(attachment.name, { cfi })
            }
            onScroll={(scrollTop, scroller) => {
              epubScrollerRef.current = scroller;
              applyScrollDirection(scrollTop);
            }}
          />
        )}
        {isMarkdown &&
          (textError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {t("attachment-preview.unavailable")}
            </div>
          ) : textContent === null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("pdf.loading")}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-6 py-4">
              <MemoContent content={textContent} density="reading" />
            </div>
          ))}
        {isHtml &&
          (textError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {t("attachment-preview.unavailable")}
            </div>
          ) : !isVisibilityResolved ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("pdf.loading")}
            </div>
          ) : (
            <iframe
              key={isPrivate ? "private" : "shared"}
              title={attachment.filename}
              srcDoc={textContent ?? ""}
              sandbox={isPrivate ? "allow-scripts" : "allow-same-origin"}
              className="h-full w-full border-0"
            />
          ))}
      </div>
      {!isHtml && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t("attachment-preview.back-to-top")}
          className={cn(
            "absolute bottom-6 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-opacity duration-200 hover:bg-accent",
            showBackToTop ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <ArrowUpIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default AttachmentPreview;
