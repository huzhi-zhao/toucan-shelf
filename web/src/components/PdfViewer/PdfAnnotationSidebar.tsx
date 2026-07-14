import { PencilIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import MemoContent from "@/components/MemoContent";
import MemoEditor from "@/components/MemoEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { PdfAnnotationEntry } from "./usePdfAnnotations";

interface Props {
  annotations: PdfAnnotationEntry[];
  selectedMemoName?: string;
  onSelect?: (memoName: string, page: number) => void;
  onClose?: () => void;
  /** Called after an annotation's memo is edited in place, so the caller can refetch. */
  onEdited?: () => void;
  className?: string;
}

// Docked comment list, modeled after Adobe Acrobat's comments panel (title bar toggle,
// grouped by page, click-to-jump) but kept more compact: no per-comment reply affordance,
// smaller card padding, no avatar row — this app's PDF notes are jump targets, not a thread.
export const PdfAnnotationSidebar = ({ annotations, selectedMemoName, onSelect, onClose, onEdited, className }: Props) => {
  const t = useTranslate();
  const selectedRef = useRef<HTMLDivElement>(null);
  const [editingMemoName, setEditingMemoName] = useState<string>();

  const pages = new Map<number, PdfAnnotationEntry[]>();
  for (const entry of annotations) {
    const list = pages.get(entry.page) ?? [];
    list.push(entry);
    pages.set(entry.page, list);
  }

  // Keep the selected entry (just created, or clicked on-page) in view instead of
  // leaving it scrolled off this independently-scrolling list.
  useEffect(() => {
    if (!selectedMemoName) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedMemoName]);

  return (
    <div
      className={cn(
        "w-full h-full min-h-0 flex flex-col border-l border-t border-border bg-background",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">
          {t("pdf.annotations")}
          {annotations.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{annotations.length}</span>}
        </span>
        {onClose && (
          <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onClose}>
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-3 p-2.5 text-sm">
        {annotations.length === 0 ? (
          <div className="text-sm text-muted-foreground px-2 py-4">{t("pdf.no-annotations")}</div>
        ) : (
          Array.from(pages.entries()).map(([page, entries]) => (
            <div key={page} className="flex flex-col gap-1.5 min-w-0">
              <div className="px-0.5 text-xs font-medium text-muted-foreground">{t("pdf.page-n", { page })}</div>
              {entries.map((entry) => {
                const isSelected = entry.memo.name === selectedMemoName;
                const text = entry.memo.content || entry.memo.snippet;
                const isEditing = editingMemoName === entry.memo.name;

                if (isEditing) {
                  return (
                    <div key={entry.memo.name} ref={isSelected ? selectedRef : undefined} className="min-w-0 rounded-lg border border-primary/40 p-1.5">
                      <MemoEditor
                        autoFocus
                        memo={entry.memo}
                        parentMemoName={entry.memo.parent || undefined}
                        onConfirm={() => {
                          setEditingMemoName(undefined);
                          onEdited?.();
                        }}
                        onCancel={() => setEditingMemoName(undefined)}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={entry.memo.name}
                    ref={isSelected ? selectedRef : undefined}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "min-w-0 text-left rounded-lg border px-2.5 py-2 text-xs leading-relaxed transition-colors cursor-pointer",
                      isSelected
                        ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                        : "border-border/60 bg-accent/30 text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground",
                    )}
                    title={entry.memo.content}
                    onClick={() => onSelect?.(entry.memo.name, entry.page)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelect?.(entry.memo.name, entry.page);
                    }}
                  >
                    <div className="break-words [&_*]:!text-xs">
                      <MemoContent
                        content={text}
                        memoName={entry.memo.name}
                        compact
                        contentClassName="!p-0"
                        actions={
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingMemoName(entry.memo.name);
                            }}
                          >
                            <PencilIcon className="w-3 h-3" />
                            {t("common.edit")}
                          </button>
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </nav>
    </div>
  );
};
