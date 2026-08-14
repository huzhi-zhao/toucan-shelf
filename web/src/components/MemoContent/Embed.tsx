import { FileTextIcon } from "lucide-react";
import { useMemo as useReactMemo } from "react";
import MemoContent from "@/components/MemoContent";
import { useMemo as useMemoDetail } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useDocumentLinkContext } from "./DocumentLinkContext";
import { EmbedAncestryProvider, MAX_EMBED_DEPTH, useEmbedAncestry } from "./EmbedAncestryContext";

interface EmbedProps {
  /** Raw text between `![[` and `]]`, a root-relative document path (e.g. `/folder/doc.md`). */
  target: string;
}

function EmbedNotice({ children, tone }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return (
    <span className={cn("text-sm", tone === "muted" && "text-muted-foreground", tone === "error" && "text-destructive")}>{children}</span>
  );
}

/**
 * Renders `![[target]]` as the target document's body, merged into the current document's flow
 * exactly like the rest of its content — no card, border, or header, matching how a .view
 * references another document's markdown. Frontmatter of the embedded document is always
 * stripped before rendering (same as a top-level document — see MemoMarkdownRenderer's own
 * `parseFrontmatter` call), so it never leaks into the parent regardless of embed depth.
 * Cycle/depth guards run before any fetch or recursive render.
 */
export const Embed: React.FC<EmbedProps> = ({ target }) => {
  const documentLinkContext = useDocumentLinkContext();
  const ancestry = useEmbedAncestry();
  const resolvedName = documentLinkContext?.resolve(target);

  if (!resolvedName) {
    return <EmbedNotice tone="muted">未找到文档：{target}</EmbedNotice>;
  }

  if (ancestry.includes(resolvedName)) {
    return <EmbedNotice tone="error">检测到循环引用，已停止展开：{target}</EmbedNotice>;
  }

  if (ancestry.length >= MAX_EMBED_DEPTH) {
    return <EmbedNotice tone="error">嵌入层级过深，已停止展开：{target}</EmbedNotice>;
  }

  return <EmbedContent target={target} resolvedName={resolvedName} ancestry={ancestry} />;
};

const EmbedContent: React.FC<{
  target: string;
  resolvedName: string;
  ancestry: string[];
}> = ({ target, resolvedName, ancestry }) => {
  const documentLinkContext = useDocumentLinkContext();
  const { data: memo, isLoading, isError } = useMemoDetail(resolvedName);
  const body = useReactMemo(() => (memo ? parseFrontmatter(memo.content).body : ""), [memo]);

  if (isLoading) {
    return <EmbedNotice tone="muted">加载中…</EmbedNotice>;
  }
  if (isError || !memo) {
    return <EmbedNotice tone="muted">无法加载文档：{target}</EmbedNotice>;
  }

  return (
    <span className="block">
      <button
        type="button"
        onClick={() => documentLinkContext?.navigate(resolvedName, target)}
        className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
      >
        <FileTextIcon className="w-4 h-4 shrink-0" />
        <span className="truncate">{memo.title || resolvedName}</span>
      </button>
      <EmbedAncestryProvider ancestry={[...ancestry, resolvedName]}>
        <MemoContent content={body} memoName={resolvedName} showProperties={false} />
      </EmbedAncestryProvider>
      {/* Closes the embedded range: without it the reader can't tell where the
          referenced document's content ends and the host document resumes. */}
      <button
        type="button"
        onClick={() => documentLinkContext?.navigate(resolvedName, target)}
        className="mt-1 block w-full truncate border-t border-border pt-0.5 text-right text-xs text-primary hover:underline"
      >
        {memo.title || resolvedName}
      </button>
    </span>
  );
};
