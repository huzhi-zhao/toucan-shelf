import { CheckIcon, ColumnsIcon, RotateCcwIcon, RowsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { applyHunks, buildDiffRows, countHunks, type DiffRow, type InlinePart } from "@/utils/textDiff";

interface Props {
  open: boolean;
  original: string;
  revised: string;
  onOpenChange: (open: boolean) => void;
  /** Called with the merged text when the user applies the review. */
  onApply: (text: string) => void;
}

const GUTTER = "w-10 shrink-0 select-none pr-2 text-right text-xs leading-6 text-muted-foreground/60";
const CELL = "flex-1 whitespace-pre-wrap break-words px-2 text-sm leading-6 font-mono";

function Line({ text, parts, tone }: { text: string; parts?: InlinePart[]; tone: "removed" | "added" | "equal" }) {
  const mark = tone === "removed" ? "bg-red-500/25" : "bg-green-500/25";
  if (!parts) return <>{text === "" ? " " : text}</>;
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.changed ? cn(mark, "rounded-xs") : undefined}>
          {part.text}
        </span>
      ))}
    </>
  );
}

/** One accept/reject toggle, rendered on the first row of each change block. */
function HunkToggle({ accepted, onToggle, label }: { accepted: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={accepted}
      onClick={onToggle}
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
        accepted
          ? "border-green-500/60 bg-green-500/20 text-green-600 dark:text-green-400"
          : "border-border text-transparent hover:border-muted-foreground",
      )}
    >
      <CheckIcon className="size-3.5" />
    </button>
  );
}

/**
 * VS Code-style review of an AI rewrite: the original and the rewritten text
 * side by side (or stacked on narrow screens), changed words highlighted, and
 * a per-block accept toggle so a rewrite can be taken in part. Nothing touches
 * the document until "Apply" — that is the whole point of the screen.
 */
export function PolishDiffDialog({ open, original, revised, onOpenChange, onApply }: Props) {
  const t = useTranslate();
  const [inline, setInline] = useState(false);
  const rows = useMemo(() => buildDiffRows(original, revised), [original, revised]);
  const total = useMemo(() => countHunks(rows), [rows]);
  // Every change starts accepted: the common case is taking the whole rewrite,
  // and rejecting a block is the deliberate act.
  const [rejected, setRejected] = useState<ReadonlySet<number>>(() => new Set());
  const accepted = useMemo(
    () => new Set(Array.from({ length: total }, (_, index) => index).filter((index) => !rejected.has(index))),
    [total, rejected],
  );

  const toggle = (hunk: number) =>
    setRejected((current) => {
      const next = new Set(current);
      if (!next.delete(hunk)) next.add(hunk);
      return next;
    });

  const firstRowOfHunk = new Map<number, DiffRow>();
  for (const row of rows) {
    if (row.hunk !== null && !firstRowOfHunk.has(row.hunk)) firstRowOfHunk.set(row.hunk, row);
  }

  const rowTint = (row: DiffRow, side: "left" | "right") => {
    if (row.hunk === null) return undefined;
    const taken = accepted.has(row.hunk);
    if (side === "left") return taken ? "bg-red-500/10" : "bg-muted/60";
    return taken ? "bg-green-500/10" : "bg-muted/60 opacity-60";
  };

  const renderRow = (row: DiffRow, index: number) => {
    const toggleCell =
      row.hunk !== null && firstRowOfHunk.get(row.hunk) === row ? (
        <HunkToggle
          accepted={accepted.has(row.hunk)}
          onToggle={() => toggle(row.hunk as number)}
          label={accepted.has(row.hunk) ? t("editor.polish.diff.reject-hunk") : t("editor.polish.diff.accept-hunk")}
        />
      ) : (
        <div className="size-5 shrink-0" />
      );

    if (inline) {
      return (
        <div key={index} className="flex flex-col">
          {row.left !== null && (
            <div className={cn("flex items-start gap-1", rowTint(row, "left"))}>
              {toggleCell}
              <span className={GUTTER}>{row.leftNumber}</span>
              <span className={CELL}>
                <Line text={row.left} parts={row.leftParts} tone={row.type === "equal" ? "equal" : "removed"} />
              </span>
            </div>
          )}
          {row.right !== null && row.type !== "equal" && (
            <div className={cn("flex items-start gap-1", rowTint(row, "right"))}>
              <div className="size-5 shrink-0" />
              <span className={GUTTER}>{row.rightNumber}</span>
              <span className={CELL}>
                <Line text={row.right} parts={row.rightParts} tone="added" />
              </span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={index} className="flex items-stretch">
        <div className={cn("flex min-w-0 flex-1 items-start gap-1", rowTint(row, "left"))}>
          {toggleCell}
          <span className={GUTTER}>{row.leftNumber ?? ""}</span>
          <span className={CELL}>
            {row.left === null ? " " : <Line text={row.left} parts={row.leftParts} tone={row.type === "equal" ? "equal" : "removed"} />}
          </span>
        </div>
        <div className="w-px shrink-0 bg-border" />
        <div className={cn("flex min-w-0 flex-1 items-start gap-1 pl-1", rowTint(row, "right"))}>
          <span className={GUTTER}>{row.rightNumber ?? ""}</span>
          <span className={CELL}>
            {row.right === null ? " " : <Line text={row.right} parts={row.rightParts} tone={row.type === "equal" ? "equal" : "added"} />}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="gap-3 md:max-w-4xl">
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-6">
          <DialogTitle className="text-base">
            {t("editor.polish.diff.title")}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {total === 0 ? t("editor.polish.diff.no-changes") : t("editor.polish.diff.change-count", { count: total })}
            </span>
          </DialogTitle>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setInline((value) => !value)}>
            {inline ? <ColumnsIcon className="size-3.5" /> : <RowsIcon className="size-3.5" />}
            {inline ? t("editor.polish.diff.side-by-side") : t("editor.polish.diff.inline")}
          </Button>
        </DialogHeader>

        {!inline && (
          <div className="flex gap-4 border-b pb-1 text-xs font-medium text-muted-foreground">
            <span className="flex-1 pl-12">{t("editor.polish.diff.original")}</span>
            <span className="flex-1 pl-12">{t("editor.polish.diff.revised")}</span>
          </div>
        )}

        <div className="min-h-32 max-h-[55vh] overflow-auto rounded-md border bg-background py-1">{rows.map(renderRow)}</div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-xs"
            disabled={total === 0}
            onClick={() =>
              setRejected((current) => (current.size === total ? new Set() : new Set(Array.from({ length: total }, (_, i) => i))))
            }
          >
            <RotateCcwIcon className="size-3.5" />
            {rejected.size === total ? t("editor.polish.diff.accept-all") : t("editor.polish.diff.reject-all")}
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" className="h-8" onClick={() => onApply(applyHunks(rows, accepted))}>
              {t("editor.polish.diff.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
