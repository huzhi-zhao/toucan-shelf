import { useMemo } from "react";
import { useInfiniteMemoComments } from "@/hooks/useMemoQueries";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

export interface EpubAnnotationEntry {
  /** The comment memo carrying this annotation. */
  memo: Memo;
  /** EPUB CFI range identifying the highlighted text span. */
  cfiRange: string;
  /** The selected text snippet, shown as the anchor label. */
  textSnippet: string;
  /** The mark's color preset key ("" = default). */
  color: string;
  /** When true the mark renders as an underline; otherwise as a background highlight. */
  underline: boolean;
  /** Whether this annotation has a written note (vs. a bare mark with empty content). */
  hasNote: boolean;
}

/**
 * Reads every comment on `parentMemoName` and filters down to the ones anchored to
 * `attachmentName` (an EPUB attachment). Like PDF annotations, these are regular comment
 * memos — just ones whose `payload.epubAnnotation` is set — so they ride on the same
 * MemoRelation/COMMENT plumbing the comment section already uses.
 */
export function useEpubAnnotations(parentMemoName: string | undefined, attachmentName: string | undefined) {
  const { data, isLoading, refetch } = useInfiniteMemoComments(parentMemoName ?? "", { enabled: !!parentMemoName });

  const all = useMemo(() => {
    const entries: EpubAnnotationEntry[] = [];
    for (const memo of data ?? []) {
      const annotation = memo.epubAnnotation;
      if (!annotation || annotation.attachmentName !== attachmentName) continue;
      entries.push({
        memo,
        cfiRange: annotation.cfiRange,
        textSnippet: annotation.textSnippet,
        color: annotation.color,
        underline: annotation.underline,
        hasNote: memo.content.trim().length > 0,
      });
    }
    return entries;
  }, [data, attachmentName]);

  return { all, loading: isLoading, refetch };
}
