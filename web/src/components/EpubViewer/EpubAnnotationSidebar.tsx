import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { CommentCard } from "@/components/DocComments/CommentCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { EpubAnnotationEntry } from "./useEpubAnnotations";

interface Props {
  annotations: EpubAnnotationEntry[];
  selectedMemoName?: string;
  onSelect?: (memoName: string, cfiRange: string) => void;
  onClose?: () => void;
  /** Called after an annotation's memo is edited in place, so the caller can refetch. */
  onEdited?: () => void;
  className?: string;
}

// Docked comment list for the EPUB reader, mirroring PdfAnnotationSidebar but without the
// page grouping EPUB doesn't have — entries are a flat, click-to-jump list keyed by CFI.
export const EpubAnnotationSidebar = ({ annotations, selectedMemoName, onSelect, onClose, onEdited, className }: Props) => {
  const t = useTranslate();
  const selectedRef = useRef<HTMLDivElement>(null);

  // Keep the selected entry (just created, or clicked in-text) in view.
  useEffect(() => {
    if (!selectedMemoName) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedMemoName]);

  return (
    <div className={cn("w-full h-full min-h-0 flex flex-col border-l border-t border-border bg-background", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">
          {t("epub.annotations")}
          {annotations.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{annotations.length}</span>}
        </span>
        {onClose && (
          <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onClose}>
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1.5 p-2.5 text-sm">
        {annotations.length === 0 ? (
          <div className="text-sm text-muted-foreground px-2 py-4">{t("epub.no-annotations")}</div>
        ) : (
          annotations.map((entry) => {
            const isSelected = entry.memo.name === selectedMemoName;
            return (
              <CommentCard
                key={entry.memo.name}
                ref={isSelected ? selectedRef : undefined}
                memo={entry.memo}
                selected={isSelected}
                onSelect={() => onSelect?.(entry.memo.name, entry.cfiRange)}
                onEdited={onEdited}
              />
            );
          })
        )}
      </nav>
    </div>
  );
};
