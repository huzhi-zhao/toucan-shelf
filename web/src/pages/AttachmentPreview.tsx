import { ArrowUpIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { isHtmlAttachment, isPdfAttachment } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { PdfDocumentView } from "@/components/PdfViewer/PdfDocumentView";
import { attachmentNamePrefix } from "@/helpers/resource-names";
import { useAttachment } from "@/hooks/useAttachmentQueries";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { getDocScrollPosition, restoreScrollTopWhenReady, saveDocScrollPosition } from "@/utils/scrollPositionCache";

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
  const toolbarSlotRef = useCallback((node: HTMLDivElement | null) => setToolbarSlot(node), []);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [htmlError, setHtmlError] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const hideAnchorRef = useRef(0);
  const saveScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const name = params.uid ? `${attachmentNamePrefix}${params.uid}` : "";
  const { data: attachment, isLoading, error } = useAttachment(name, { enabled: !!name });

  const isHtml = attachment ? isHtmlAttachment(attachment) : false;
  const isPdf = attachment ? isPdfAttachment(attachment) : false;
  const cachedPosition = attachment ? getDocScrollPosition(attachment.name) : undefined;

  const isParentMemoQueryEnabled = !!attachment?.memo && isHtml;
  const { data: parentMemo, isPending: isParentMemoPending } = useMemoQuery(attachment?.memo ?? "", {
    enabled: isParentMemoQueryEnabled,
  });
  // Scripts only run for HTML attachments on memos that are still PRIVATE (creator-only).
  // Anything shared (PROTECTED/PUBLIC) stays script-free to prevent stored XSS from
  // reaching other viewers. See AttachmentPreview iframe below.
  const isPrivate = parentMemo?.visibility === Visibility.PRIVATE;
  // A sandboxed iframe locks in its permissions at srcDoc navigation time, so we must
  // know isPrivate *before* first render — otherwise a later attribute change can't
  // retroactively grant/revoke script execution. Wait for the visibility check to settle.
  const isVisibilityResolved = !isParentMemoQueryEnabled || !isParentMemoPending;

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
    if (!attachment || !isHtml) {
      return;
    }
    let cancelled = false;
    fetch(getAttachmentUrl(attachment))
      .then((res) => {
        if (!res.ok) throw new Error("failed to fetch attachment");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtmlContent(text);
      })
      .catch(() => {
        if (!cancelled) setHtmlError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, isHtml]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    setShowBackToTop(scrollTop > BACK_TO_TOP_THRESHOLD);

    if (scrollTop <= lastScrollTopRef.current) {
      // Scrolling up (or at the top): reveal the header immediately.
      setHeaderHidden(false);
      hideAnchorRef.current = scrollTop;
    } else if (scrollTop - hideAnchorRef.current > HEADER_HIDE_THRESHOLD) {
      setHeaderHidden(true);
    }
    lastScrollTopRef.current = scrollTop;

    if (isPdf && attachment) {
      clearTimeout(saveScrollTimeoutRef.current);
      saveScrollTimeoutRef.current = setTimeout(() => saveDocScrollPosition(attachment.name, { scrollTop }), 300);
    }
  }, [isPdf, attachment]);

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
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (isLoading) {
    return <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">{t("pdf.loading")}</div>;
  }

  if (error || !attachment || (!isPdf && !isHtml)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-destructive">
        {t("attachment-preview.unavailable")}
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {!isHtml && (
        <div
          className={cn(
            "absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between gap-3 border-b border-border bg-background px-4 py-2 transition-transform duration-300",
            headerHidden && "-translate-y-full",
          )}
        >
          <span className="truncate text-sm font-medium text-foreground" title={attachment.filename}>
            {attachment.filename}
          </span>
          <div ref={toolbarSlotRef} className="flex shrink-0 items-center gap-1" />
        </div>
      )}
      <div ref={scrollContainerRef} onScroll={handleScroll} className={cn("h-full overflow-y-auto", !isHtml && "pt-11")}>
        {isPdf && toolbarSlot && (
          <PdfDocumentView
            url={getAttachmentUrl(attachment)}
            toolbarSlot={toolbarSlot}
            className="px-6 py-4"
            parentMemoName={attachment.memo}
            attachmentName={attachment.name}
            filename={attachment.filename}
            initialPageNumber={cachedPosition?.page}
            onPageNumberChange={(page) => saveDocScrollPosition(attachment.name, { page })}
          />
        )}
        {isHtml &&
          (htmlError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">{t("attachment-preview.unavailable")}</div>
          ) : !isVisibilityResolved ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("pdf.loading")}</div>
          ) : (
            <iframe
              key={isPrivate ? "private" : "shared"}
              title={attachment.filename}
              srcDoc={htmlContent ?? ""}
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
