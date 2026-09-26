import copy from "copy-to-clipboard";
import { FileTextIcon, LinkIcon } from "lucide-react";
import toast from "react-hot-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { extractMemoIdFromName } from "@/helpers/resource-names";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { subDocHref } from "@/utils/subDoc";

interface Props {
  memo: Memo;
  /** Emphasized when the body's footnote-style reference points at this entry. */
  highlighted?: boolean;
  /** The document this sub-document hangs off, needed to write a reference to it. */
  parentMemoName?: string;
}

/**
 * One entry in the References section. Clicking it opens the sub-document's own
 * detail page, which is an ordinary memo page — so editing and printing (via the
 * reader's browser print) come for free rather than needing their own surface
 * here.
 *
 * It opens in a new tab rather than navigating in place. A sub-document is
 * consulted while reading the document it belongs to, not instead of it: sending
 * the reader away would cost them their scroll position in the main document and
 * make them walk back for every aside they look at.
 */
export const SubDocCard = ({ memo, highlighted, parentMemoName }: Props) => {
  const t = useTranslate();
  // A sub-document's body is markdown like any other document's, and its
  // frontmatter is chrome rather than content — showing "---\ntags: …" as the
  // preview line would say nothing about what the document holds.
  const preview = parseFrontmatter(memo.content).body.trim().split("\n")[0] ?? "";

  return (
    <a
      href={`/memos/${extractMemoIdFromName(memo.name)}`}
      target="_blank"
      rel="noreferrer"
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
      {/* Writing the reference by hand would mean typing the reserved path,
          which is addressed by uid and not meant to be typed. Copying it is how
          a sub-document gets mentioned in the body. */}
      {parentMemoName && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="ml-auto shrink-0 rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                // The card itself is a link; copying must not also open it.
                event.preventDefault();
                event.stopPropagation();
                copy(`[${memo.title}](${subDocHref(parentMemoName, memo.title)})`);
                toast.success(t("message.copied"));
              }}
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("subdoc.copy-reference")}</TooltipContent>
        </Tooltip>
      )}
    </a>
  );
};

export default SubDocCard;
