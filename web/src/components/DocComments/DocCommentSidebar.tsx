import { HashIcon, MessageCirclePlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import MemoEditor from "@/components/MemoEditor";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import type { DocAnchor, Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { CommentCard } from "./CommentCard";
import type { AnchorHealth } from "./useAnchorHealth";

interface Props {
  /** The document memo the comments are anchored to. */
  parentMemoName: string;
  comments: Memo[];
  onClose?: () => void;
  /** Refetch the comment list after a create/edit. */
  onChanged?: () => void;
  /** Scrolls the document preview to what a comment is anchored to (its marked text, else its heading). */
  onJump?: (anchor: DocAnchor | undefined) => void;
  /** The comment whose mark is emphasized in the document, kept in sync with the cards. */
  selectedMemoName?: string;
  onSelect?: (memoName: string) => void;
  /** Per-comment anchor state; "orphan" cards are grouped out and offered a re-anchor. */
  anchorHealth?: Map<string, AnchorHealth>;
  /** Start re-anchoring an orphaned comment to a fresh text selection in the document. */
  onRelink?: (comment: Memo) => void;
  /** Delete an orphaned comment outright. */
  onDelete?: (comment: Memo) => void;
  /**
   * External request to open the composer pre-anchored to a specific selection (from the
   * selection popover). Bump `nonce` to (re)open the editor; `anchor` seeds the anchor chip.
   */
  composeRequest?: { anchor: DocAnchor; nonce: number };
  className?: string;
}

// Docked comment panel for notebook documents (markdown / view docs). Reuses the same
// compact card + inline-edit affordance as the PDF annotation sidebar (via CommentCard),
// as a plain comment thread. A comment is anchored to the text it was written about (or to
// nothing at all, for a comment on the document as a whole), so clicking it jumps back to
// that passage.
export const DocCommentSidebar = ({
  parentMemoName,
  comments,
  onClose,
  onChanged,
  onJump,
  selectedMemoName,
  onSelect,
  anchorHealth,
  onRelink,
  onDelete,
  composeRequest,
  className,
}: Props) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const [showEditor, setShowEditor] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<DocAnchor | undefined>();

  // The panel's own compose button writes a comment about the document as a whole — deliberately
  // unanchored. Anchoring is what selecting text in the document is for; guessing an anchor from
  // the scroll position (as this used to, by picking the nearest heading above the fold) produced
  // comments nobody had aimed anywhere, which then went stale as soon as that heading was renamed.
  const openEditor = () => {
    setPendingAnchor(undefined);
    setShowEditor(true);
  };

  // Open the composer pre-anchored when the selection popover fires a compose request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!composeRequest) return;
    setPendingAnchor(composeRequest.anchor);
    setShowEditor(true);
  }, [composeRequest?.nonce]);

  const isOrphan = (comment: Memo) => anchorHealth?.get(comment.name) === "orphan";
  const liveComments = comments.filter((c) => !isOrphan(c));
  const orphanComments = comments.filter(isOrphan);

  const renderCard = (comment: Memo) => {
    const anchor = comment.docAnchor;
    const stale = isOrphan(comment);
    return (
      <CommentCard
        key={comment.name}
        memo={comment}
        selected={comment.name === selectedMemoName}
        // A marked comment labels itself with the text it marks, which says far more about
        // what it's about than the section it happens to sit in; legacy heading-anchored
        // comments keep showing their heading.
        anchorLabel={anchor?.textExact || anchor?.headingText}
        anchorColor={anchor?.textExact ? anchor.color : undefined}
        anchorStale={stale}
        staleLabel={t("mark.text-changed")}
        emptyLabel={t("mark.note-less")}
        onSelect={
          anchor && !stale
            ? () => {
                onSelect?.(comment.name);
                onJump?.(anchor);
              }
            : undefined
        }
        onEdited={onChanged}
        onRelink={stale && onRelink ? () => onRelink(comment) : undefined}
        onDelete={stale && onDelete ? () => onDelete(comment) : undefined}
      />
    );
  };

  return (
    <div className={cn("w-full h-full min-h-0 flex flex-col border-l border-t border-border bg-background", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-foreground">
          {t("memo.comment.self")}
          {comments.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{comments.length}</span>}
        </span>
        <div className="flex items-center gap-0.5">
          {currentUser && !showEditor && (
            <Button variant="ghost" size="icon" className="w-6 h-6" title={t("memo.comment.write-a-comment")} onClick={openEditor}>
              <MessageCirclePlusIcon className="w-3.5 h-3.5" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onClose}>
              <XIcon className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2 p-2.5 text-sm">
        {showEditor && (
          <div className="min-w-0 rounded-lg border border-primary/40 p-1.5">
            {pendingAnchor?.textExact && (
              <div className="mb-1 flex items-center gap-0.5 px-0.5 text-[11px] font-medium text-muted-foreground/80">
                <HashIcon className="w-3 h-3 shrink-0" />
                <span className="truncate">{pendingAnchor.textExact}</span>
              </div>
            )}
            <MemoEditor
              autoFocus
              cacheKey={`doc-comment-${parentMemoName}`}
              placeholder={t("editor.add-your-comment-here")}
              parentMemoName={parentMemoName}
              docAnchor={pendingAnchor}
              toolbarVariant="comment"
              onConfirm={() => {
                setShowEditor(false);
                onChanged?.();
              }}
              onCancel={() => setShowEditor(false)}
            />
          </div>
        )}
        {comments.length === 0 && !showEditor ? (
          <div className="text-sm text-muted-foreground px-2 py-4">{t("memo.comment.empty")}</div>
        ) : (
          <>
            {liveComments.map(renderCard)}
            {orphanComments.length > 0 && (
              // Orphans are grouped at the bottom rather than left in place: they no longer point
              // anywhere in the document, so ordering them against the text is meaningless, and
              // collecting them makes the "these need re-anchoring" pile obvious.
              <>
                <div className="mt-1 flex items-center gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  <span className="h-px flex-1 bg-border" />
                  {t("mark.orphaned")}
                  <span className="ml-0.5 font-normal normal-case tracking-normal">{orphanComments.length}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                {orphanComments.map(renderCard)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
