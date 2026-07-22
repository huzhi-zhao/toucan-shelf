import { HashIcon, MessageCirclePlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import MemoEditor from "@/components/MemoEditor";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import type { DocAnchor, Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { CommentCard } from "./CommentCard";

interface Props {
  /** The document memo the comments are anchored to. */
  parentMemoName: string;
  comments: Memo[];
  onClose?: () => void;
  /** Refetch the comment list after a create/edit. */
  onChanged?: () => void;
  /** Captures the heading a new comment should anchor to (nearest heading above the current scroll). */
  getAnchor?: () => DocAnchor | undefined;
  /** Scrolls the document preview to what a comment is anchored to (its marked text, else its heading). */
  onJump?: (anchor: DocAnchor | undefined) => void;
  /** The comment whose mark is emphasized in the document, kept in sync with the cards. */
  selectedMemoName?: string;
  onSelect?: (memoName: string) => void;
  /** Comments whose marked text is no longer in the document, shown with a "text changed" note. */
  unresolvedMarks?: string[];
  /**
   * External request to open the composer pre-anchored to a specific heading (e.g. from the
   * selection popover). Bump `nonce` to (re)open the editor; `anchor` seeds the anchor chip.
   */
  composeRequest?: { anchor: DocAnchor; nonce: number };
  className?: string;
}

// Docked comment panel for notebook documents (markdown / view docs). Reuses the same
// compact card + inline-edit affordance as the PDF annotation sidebar (via CommentCard),
// as a plain comment thread. Each comment is anchored to the heading nearest above the
// scroll position when it was written, so clicking it jumps back to that section.
export const DocCommentSidebar = ({
  parentMemoName,
  comments,
  onClose,
  onChanged,
  getAnchor,
  onJump,
  selectedMemoName,
  onSelect,
  unresolvedMarks,
  composeRequest,
  className,
}: Props) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const [showEditor, setShowEditor] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<DocAnchor | undefined>();

  const openEditor = () => {
    setPendingAnchor(getAnchor?.());
    setShowEditor(true);
  };

  // Open the composer pre-anchored when the selection popover fires a compose request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!composeRequest) return;
    setPendingAnchor(composeRequest.anchor);
    setShowEditor(true);
  }, [composeRequest?.nonce]);

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
            {pendingAnchor?.headingText && (
              <div className="mb-1 flex items-center gap-0.5 px-0.5 text-[11px] font-medium text-muted-foreground/80">
                <HashIcon className="w-3 h-3 shrink-0" />
                <span className="truncate">{pendingAnchor.headingText}</span>
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
          comments.map((comment) => {
            const anchor = comment.docAnchor;
            const stale = !!anchor?.textExact && !!unresolvedMarks?.includes(comment.name);
            return (
              <CommentCard
                key={comment.name}
                memo={comment}
                selected={comment.name === selectedMemoName}
                // A marked comment labels itself with the text it marks, which says far more about
                // what it's about than the section it happens to sit in; heading-only comments keep
                // showing their heading.
                anchorLabel={anchor?.textExact || anchor?.headingText}
                anchorColor={anchor?.textExact ? anchor.color : undefined}
                anchorStale={stale}
                staleLabel={t("mark.text-changed")}
                onSelect={
                  anchor
                    ? () => {
                        onSelect?.(comment.name);
                        onJump?.(anchor);
                      }
                    : undefined
                }
                onEdited={onChanged}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
