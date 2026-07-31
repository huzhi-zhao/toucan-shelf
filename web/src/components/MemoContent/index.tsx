import { ChevronDown, ChevronUp } from "lucide-react";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { PdfDocCard } from "@/components/PdfViewer/PdfDocCard";
import { PdfViewer } from "@/components/PdfViewer/PdfViewer";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { getReadingSpacingStyle, subscribeReadingPreferences } from "@/utils/readingDensity";
import { extractMentionUsernames } from "@/utils/remark-plugins/remark-mention";
import { COMPACT_MODE_CONFIG, getPreviewMaxHeightPx } from "./constants";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { useCompactLabel, useCompactMode } from "./hooks";
import { MemoMarkdownRenderer } from "./MemoMarkdownRenderer";
import { useResolvedMentionUsernames } from "./MentionResolutionContext";
import type { MemoContentProps } from "./types";

const MemoContent = (props: MemoContentProps) => {
  const {
    className,
    contentClassName,
    content,
    density = "compact",
    isHtml,
    isPdf,
    pdfTitle,
    pdfUrl,
    pdfAttachment,
    pdfDetailView,
    actions,
    onClick,
    onDoubleClick,
  } = props;
  const t = useTranslate();
  const [htmlPreviewHeight, setHtmlPreviewHeight] = useState(0);
  const {
    containerRef: memoContentContainerRef,
    mode: showCompactMode,
    toggle: toggleCompactMode,
  } = useCompactMode((Boolean(props.compact) || Boolean(props.autoFold)) && !props.alwaysExpanded, isHtml ? htmlPreviewHeight : content);
  const mentionUsernames = useMemo(() => extractMentionUsernames(content), [content]);
  const resolvedMentionUsernames = useResolvedMentionUsernames(mentionUsernames);

  const compactLabel = useCompactLabel(showCompactMode, t as (key: string) => string);

  // The reader's spacing overrides must land on *this* element, not an ancestor: the density
  // preset declares the same custom properties here via `md-density-reading`, and a declaration
  // on the element always beats a value inherited from above.
  const spacingOverride = useSyncExternalStore(subscribeReadingPreferences, getReadingSpacingStyle, () => undefined);
  // Feed cards and comments render at the compact preset and are not what the reading
  // preferences are about, so the overrides only apply to the long-form surfaces.
  const readingSpacing = density === "reading" ? spacingOverride : undefined;
  const containerStyle = showCompactMode === "ALL" ? { ...readingSpacing, maxHeight: `${getPreviewMaxHeightPx()}px` } : readingSpacing;

  return (
    <div className={`w-full flex flex-col justify-start items-start text-foreground ${className || ""}`}>
      <div
        ref={memoContentContainerRef}
        data-memo-content
        className={cn(
          "relative w-full max-w-full wrap-break-word text-base leading-[var(--md-leading)]",
          // Reading density loosens the vertical rhythm only; the content still
          // spans the full width of its pane.
          density === "reading" && "md-density-reading",
          "[&>*:last-child]:mb-0",
          // A leading heading must not push the whole document down by its (large)
          // section gap — that space separates sections, and there is nothing above.
          "[&>*:first-child]:mt-0",
          "[&_.katex-display]:max-w-full",
          "[&_.katex-display]:overflow-x-auto",
          "[&_.katex-display]:overflow-y-hidden",
          // Footnotes: quiet GitHub-style footer — thin separator, smaller muted text, unobtrusive links.
          "[&_.footnotes]:mt-4 [&_.footnotes]:border-t [&_.footnotes]:border-border [&_.footnotes]:pt-2",
          "[&_.footnotes]:text-sm [&_.footnotes]:text-muted-foreground",
          // GitHub renders footnote ref/backref links without an underline (underline on hover only).
          "[&_[data-footnote-ref]]:no-underline [&_[data-footnote-ref]:hover]:underline",
          "[&_.data-footnote-backref]:no-underline [&_.data-footnote-backref:hover]:underline",
          showCompactMode === "ALL" && "overflow-hidden",
          contentClassName,
        )}
        style={containerStyle}
        onMouseUp={onClick}
        onDoubleClick={onDoubleClick}
      >
        {isPdf ? (
          pdfDetailView && pdfUrl ? (
            <PdfViewer url={pdfUrl} />
          ) : (
            <PdfDocCard title={pdfTitle || ""} memoName={props.memoName || ""} attachment={pdfAttachment} />
          )
        ) : isHtml ? (
          <HtmlPreviewFrame content={content} onHeightChange={setHtmlPreviewHeight} />
        ) : (
          <MemoMarkdownRenderer
            content={content}
            resolvedMentionUsernames={resolvedMentionUsernames}
            memoName={props.memoName}
            compact={Boolean(props.compact)}
            headingIdPrefix={props.headingIdPrefix}
            onPropertyChange={props.onPropertyChange}
            showProperties={props.showProperties}
          />
        )}
        {showCompactMode === "ALL" && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 pointer-events-none",
              COMPACT_MODE_CONFIG.gradientHeight,
              "bg-linear-to-t from-background from-0% via-background/60 via-40% to-transparent to-100%",
            )}
          />
        )}
      </div>
      {(showCompactMode !== undefined || actions) && (
        <div className="relative w-full mt-2 flex items-center justify-between">
          {showCompactMode !== undefined ? (
            <button
              type="button"
              className="group inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={toggleCompactMode}
            >
              <span>{compactLabel}</span>
              {showCompactMode === "ALL" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
    </div>
  );
};

export default memo(MemoContent);
