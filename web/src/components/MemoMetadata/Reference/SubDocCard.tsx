import { FileTextIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { extractMemoIdFromName } from "@/helpers/resource-names";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { parseFrontmatter } from "@/utils/frontmatter";

interface Props {
  memo: Memo;
  /** Where the reader came from, so the sub-document can offer a way back. */
  parentPage?: string;
  /** Emphasized when the body's footnote-style reference points at this entry. */
  highlighted?: boolean;
}

/**
 * One entry in the References section. Clicking it opens the sub-document's own
 * detail page, which is an ordinary memo page — so editing and printing (via the
 * reader's browser print) come for free rather than needing their own surface
 * here.
 */
export const SubDocCard = ({ memo, parentPage, highlighted }: Props) => {
  // A sub-document's body is markdown like any other document's, and its
  // frontmatter is chrome rather than content — showing "---\ntags: …" as the
  // preview line would say nothing about what the document holds.
  const preview = parseFrontmatter(memo.content).body.trim().split("\n")[0] ?? "";

  return (
    <Link
      to={`/memos/${extractMemoIdFromName(memo.name)}`}
      state={parentPage ? { from: parentPage } : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        highlighted ? "border-primary/40 bg-primary/10" : "border-border/70 bg-background/65 hover:bg-accent/20",
      )}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
        <FileTextIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight text-foreground" title={memo.title}>
          {memo.title}
        </div>
        {preview && <div className="mt-1 truncate text-xs text-muted-foreground">{preview}</div>}
      </div>
    </Link>
  );
};

export default SubDocCard;
