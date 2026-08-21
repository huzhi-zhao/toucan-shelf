import copy from "copy-to-clipboard";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemoMarkdownRenderer } from "@/components/MemoContent/MemoMarkdownRenderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { PDF_PAGE_SEPARATOR } from "./extractPdfText";
import type { PdfTextBlock } from "./usePdfExtractedText";

const NO_MENTIONS = new Set<string>();

interface Props {
  blocks: PdfTextBlock[] | null;
  formatting: boolean;
  error: boolean;
  /** Called when a page heading is clicked, to scroll the PDF to that page. */
  onSelect?: (page: number) => void;
  /** When set, scrolls this page's block into view; the nonce lets repeated clicks on the
   *  same page re-trigger the scroll. */
  scrollToPage?: { page: number; nonce: number };
  onClose?: () => void;
  className?: string;
}

// Docked panel showing the PDF's extracted text as markdown, page by page. Mirrors the
// annotation sidebar's chrome (title bar, close button) and lives in the same slot — the two
// are mutually exclusive. Each page block carries a clickable "Page N" heading that scrolls the
// PDF to the matching page, giving rough text-to-page alignment (see usePdfExtractedText).
export const PdfTextSidebar = ({ blocks, formatting, error, onSelect, scrollToPage, onClose, className }: Props) => {
  const t = useTranslate();
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear any pending "Copied" feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Joins every page block with the same "---" separator the sidebar renders, so the
  // clipboard content matches what the user sees (page breaks preserved).
  const handleCopy = async () => {
    if (!blocks) return;
    const text = blocks.map((block) => block.content).join(PDF_PAGE_SEPARATOR);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const success = copy(text);
        if (!success) throw new Error("copy failed");
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Failed to copy PDF text:", err);
    }
  };

  // Scroll the requested page's block into view once it's clicked in the PDF. Depends on
  // `blocks` too so a click that arrives before the (async AI-formatted) text has loaded
  // still lands once the blocks render.
  useEffect(() => {
    if (!scrollToPage) return;
    blockRefs.current.get(scrollToPage.page)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToPage, blocks]);

  return (
    <div className={cn("w-full h-full min-h-0 flex flex-col border-l border-t border-border bg-background", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground">{t("pdf.plain-text-view")}</span>
          {blocks && blocks.length > 0 && (
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
                "transition-colors duration-200",
                "hover:bg-accent active:scale-95",
                copied ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={copied ? t("pdf.copy-text-success") : t("pdf.copy-text")}
              title={copied ? t("pdf.copy-text-success") : t("pdf.copy-text")}
            >
              {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
              <span>{copied ? t("pdf.copy-text-success") : t("pdf.copy-text")}</span>
            </button>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onClose}>
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 text-sm">
        {error ? (
          <p className="text-sm text-destructive">{t("pdf.load-failed")}</p>
        ) : blocks === null ? (
          <p className="text-sm text-muted-foreground">{formatting ? t("attachment-preview.ai-formatting") : t("pdf.loading")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {blocks.map((block, i) => (
              <div
                key={block.page ?? i}
                ref={(el) => {
                  if (block.page === null) return;
                  if (el) blockRefs.current.set(block.page, el);
                  else blockRefs.current.delete(block.page);
                }}
                className="min-w-0 scroll-mt-2"
              >
                {block.page !== null && (
                  <button
                    type="button"
                    className="mb-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() => onSelect?.(block.page as number)}
                  >
                    {t("pdf.page-n", { page: block.page })}
                  </button>
                )}
                <div className="text-sm leading-6 text-foreground break-words">
                  <MemoMarkdownRenderer content={block.content} resolvedMentionUsernames={NO_MENTIONS} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
