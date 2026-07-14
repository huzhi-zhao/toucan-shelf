import { XIcon } from "lucide-react";
import { MemoMarkdownRenderer } from "@/components/MemoContent/MemoMarkdownRenderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { PdfTextBlock } from "./usePdfExtractedText";

const NO_MENTIONS = new Set<string>();

interface Props {
  blocks: PdfTextBlock[] | null;
  formatting: boolean;
  error: boolean;
  /** Called when a page heading is clicked, to scroll the PDF to that page. */
  onSelect?: (page: number) => void;
  onClose?: () => void;
  className?: string;
}

// Docked panel showing the PDF's extracted text as markdown, page by page. Mirrors the
// annotation sidebar's chrome (title bar, close button) and lives in the same slot — the two
// are mutually exclusive. Each page block carries a clickable "Page N" heading that scrolls the
// PDF to the matching page, giving rough text-to-page alignment (see usePdfExtractedText).
export const PdfTextSidebar = ({ blocks, formatting, error, onSelect, onClose, className }: Props) => {
  const t = useTranslate();

  return (
    <div className={cn("w-full h-full min-h-0 flex flex-col border-l border-t border-border bg-background", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">{t("pdf.plain-text-view")}</span>
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
              <div key={block.page ?? i} className="min-w-0">
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
