import { PrinterIcon } from "lucide-react";
import { useEffect, useMemo as useReactMemo } from "react";
import { useParams } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import { memoNamePrefix } from "@/helpers/resource-names";
import useMemoDetailError from "@/hooks/useMemoDetailError";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { buildMemoFileBaseName } from "@/utils/memo";
import "./memoReader.css";

// Bare page (no sidebar/app chrome) opened in its own tab to read a memo as a plain
// document — and, via the browser's own print dialog, to save it as a PDF. Only the
// markdown body renders: no title bar, author, timestamps, tags, attachments or
// comments, and no frontmatter panel, so the printed page holds nothing but content.
//
// Printing is deliberately left to the user rather than triggered programmatically:
// by the time they reach for it, async content (mermaid diagrams, KaTeX, images,
// webfonts) has painted, which a scripted print() would have had to race.
const MemoReader = () => {
  const t = useTranslate();
  const params = useParams();

  const name = params.uid ? `${memoNamePrefix}${params.uid}` : "";
  const { data: memo, isLoading, error } = useMemoQuery(name, { enabled: !!name });

  useMemoDetailError({ error: error as Error | null });

  // Strip frontmatter here rather than letting the renderer do it: the renderer
  // would surface the properties as a panel above the body, which is app chrome
  // this page exists to omit.
  const body = useReactMemo(() => (memo ? parseFrontmatter(memo.content).body : ""), [memo]);

  // Browsers seed the "Save as PDF" filename from the document title, so this is
  // also how the exported PDF gets named after the memo.
  useEffect(() => {
    if (!memo) {
      return;
    }
    const previousTitle = document.title;
    document.title = buildMemoFileBaseName(memo);
    return () => {
      document.title = previousTitle;
    };
  }, [memo]);

  if (isLoading || !memo) {
    return null;
  }

  return (
    <div className="memo-reader-page mx-auto w-full max-w-3xl px-6 py-10">
      <Button
        variant="outline"
        size="sm"
        className="fixed top-4 right-4 print:hidden"
        title={t("memo.print-hint")}
        onClick={() => window.print()}
      >
        <PrinterIcon className="w-4 h-auto" />
        {t("memo.print")}
      </Button>
      <MemoContent memoName={memo.name} content={body} isHtml={memo.docType === Memo_DocType.HTML} />
    </div>
  );
};

export default MemoReader;
