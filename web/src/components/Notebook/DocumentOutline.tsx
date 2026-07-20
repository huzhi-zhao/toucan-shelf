import { PaperclipIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { extractHeadings } from "@/utils/markdown-manipulation";

// DOM id of the attachment list section rendered within the document's
// scrollable container (see DocumentView.tsx). Kept as a shared constant so
// the outline's "jump to attachments" link always matches the real anchor.
export const ATTACHMENTS_ANCHOR_ID = "document-attachments";

interface Props {
  content: string;
  containerRef: React.RefObject<HTMLElement | null>;
  hasAttachments?: boolean;
  /** Whether the document is currently open in its inline editor (no rendered DOM anchors to scroll to). */
  isEditing?: boolean;
  /** Scrolls the editor to a given 1-indexed line of its full (frontmatter-included) content. Required when `isEditing`. */
  onScrollToLine?: (line: number) => void;
}

const DocumentOutline = ({ content, containerRef, hasAttachments, isEditing, onScrollToLine }: Props) => {
  const t = useTranslate();
  // Uses the same mdast-based extraction as rehype-heading-id so the slug
  // computed here always matches the id assigned to the rendered heading,
  // even when the heading text contains inline markdown (links, emphasis, etc.).
  // Headings' `line` is relative to the body (frontmatter stripped) — track how many
  // lines the frontmatter block occupies so edit-mode navigation (which addresses the
  // full document, frontmatter included) lines up with the editor's CodeMirror content.
  const { body, frontmatterLineCount } = useMemo(() => {
    const parsedBody = parseFrontmatter(content).body;
    if (parsedBody === content) return { body: parsedBody, frontmatterLineCount: 0 };
    const totalLines = content.replace(/\r\n/g, "\n").split("\n").length;
    const bodyLines = parsedBody.split("\n").length;
    return { body: parsedBody, frontmatterLineCount: totalLines - bodyLines };
  }, [content]);
  const items = useMemo(() => extractHeadings(body), [body]);

  const scrollToId = (id: string) => {
    const container = containerRef.current;
    const target = container?.querySelector(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSelect = (item: (typeof items)[number]) => {
    if (isEditing && onScrollToLine) {
      onScrollToLine(item.line + frontmatterLineCount);
      return;
    }
    scrollToId(item.slug);
  };

  return (
    // `flex-1 min-h-0` rather than `h-full`: the desktop sidebar stacks a label above
    // this component, so 100% height would overflow the column by the label's height
    // and clip the last row / the attachments button off the bottom.
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 text-sm">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground px-2 py-4">{t("notebook.no-headings")}</div>
        ) : (
          items.map((item, idx) => (
            <button
              key={`${item.slug}-${idx}`}
              // `shrink-0` is load-bearing: `truncate` (overflow:hidden) zeroes each row's
              // automatic min-height as a flex item, so without it a long outline squeezes
              // every row below its line height instead of overflowing into the scrollbar.
              className={cn("shrink-0 text-left truncate rounded px-2 py-1 hover:bg-accent/60 text-muted-foreground hover:text-foreground")}
              style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
              onClick={() => handleSelect(item)}
            >
              {item.text}
            </button>
          ))
        )}
      </nav>
      {hasAttachments && (
        <button
          className="shrink-0 mt-2 flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          onClick={() => scrollToId(ATTACHMENTS_ANCHOR_ID)}
        >
          <PaperclipIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t("notebook.attachments")}</span>
        </button>
      )}
    </div>
  );
};

export default DocumentOutline;
