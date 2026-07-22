import { HashIcon, PencilIcon } from "lucide-react";
import { forwardRef, useState } from "react";
import MemoContent from "@/components/MemoContent";
import MemoEditor from "@/components/MemoEditor";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { getMarkColor } from "@/utils/markColors";

interface Props {
  memo: Memo;
  selected?: boolean;
  onSelect?: () => void;
  /** Optional anchor label (the marked text, or the heading), shown as a chip above the content. */
  anchorLabel?: string;
  /**
   * Palette key of the mark this comment draws in the document. Set it to show a colour swatch
   * in place of the heading glyph, so the chip reads as "this is the text I highlighted". Leave
   * undefined for heading-anchored comments; pass "" for an underline-only mark.
   */
  anchorColor?: string;
  /** The marked text is no longer in the document (it was edited away), so the chip is flagged. */
  anchorStale?: boolean;
  /** Localized notice shown when `anchorStale` — the card can't translate on its own. */
  staleLabel?: string;
  /** Called after the comment memo is edited in place, so the caller can refetch. */
  onEdited?: () => void;
}

// A single comment card, shared by the PDF annotation sidebar and the notebook document
// comment sidebar: renders the comment via MemoContent with an inline pencil that swaps to
// a MemoEditor for editing in place. Kept intentionally compact (small padding, no avatar
// row) so it reads as a docked note list rather than a full memo thread.
export const CommentCard = forwardRef<HTMLDivElement, Props>(
  ({ memo, selected, onSelect, anchorLabel, anchorColor, anchorStale, staleLabel, onEdited }, ref) => {
    const t = useTranslate();
    const [editing, setEditing] = useState(false);
    const text = memo.content || memo.snippet;

    if (editing) {
      return (
        <div ref={ref} className="min-w-0 rounded-lg border border-primary/40 p-1.5">
          <MemoEditor
            autoFocus
            memo={memo}
            parentMemoName={memo.parent || undefined}
            toolbarVariant="comment"
            onConfirm={() => {
              setEditing(false);
              onEdited?.();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      );
    }

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        className={cn(
          "min-w-0 text-left rounded-lg border px-2.5 py-2 text-xs leading-relaxed transition-colors cursor-pointer",
          selected
            ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
            : "border-border/60 bg-accent/30 text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground",
        )}
        title={memo.content}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect?.();
        }}
      >
        {anchorLabel && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground/80">
            {anchorColor === undefined ? (
              <HashIcon className="w-3 h-3 shrink-0" />
            ) : (
              // An underline-only mark has no fill colour, so show a hollow swatch for it.
              <span
                className="w-2.5 h-2.5 shrink-0 rounded-full border border-black/15"
                style={{ backgroundColor: anchorColor ? getMarkColor(anchorColor).color : "transparent" }}
              />
            )}
            <span className={cn("truncate", anchorStale && "line-through")}>{anchorLabel}</span>
            {anchorStale && staleLabel && <span className="shrink-0 text-muted-foreground/70">· {staleLabel}</span>}
          </div>
        )}
        <div className="break-words [&_*]:!text-xs">
          <MemoContent
            content={text}
            memoName={memo.name}
            compact
            contentClassName="!p-0"
            actions={
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
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
  },
);

CommentCard.displayName = "CommentCard";
