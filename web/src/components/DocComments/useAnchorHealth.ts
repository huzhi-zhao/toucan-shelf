import { useEffect, useMemo, useState } from "react";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/**
 * Whether a comment can still find what it was anchored to in the current document.
 *
 * "orphan" is the interesting state: the document was edited and the passage (or, for legacy
 * heading-anchored comments, the section) the comment was written about is gone. An orphaned
 * comment has no mark to draw and nothing to scroll to, so unless the sidebar lists it and
 * offers a way to re-anchor it, it becomes unreachable — which is how a note ends up silently
 * lost even though its memo is still there in the database.
 */
export type AnchorHealth = "ok" | "orphan";

const HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]";

/**
 * Classifies every comment's anchor against the rendered document.
 *
 * Text-anchored comments (the current scheme) are judged by the mark layer, which already has to
 * resolve every quote to draw it and reports the ones it couldn't via `unresolvedMarks`.
 * Heading-anchored comments (the legacy scheme, kept read-only) are judged here, by looking for
 * the heading's slug in the rendered document. Comments with no anchor at all are always "ok" —
 * they're about the document as a whole and nothing can detach them.
 *
 * `contentKey` should change whenever the rendered document does, so the heading pass re-runs.
 */
export const useAnchorHealth = (
  comments: Memo[],
  unresolvedMarks: string[],
  containerRef: React.RefObject<HTMLElement | null>,
  contentKey: string,
): Map<string, AnchorHealth> => {
  const [missingHeadings, setMissingHeadings] = useState<Set<string>>(() => new Set());

  // Legacy heading anchors: a slug that no longer exists in the document is orphaned. Runs after
  // paint (the headings have to be in the DOM) and only over the slugs actually in use.
  useEffect(() => {
    const container = containerRef.current;
    const slugs = new Set<string>();
    for (const comment of comments) {
      const anchor = comment.docAnchor;
      if (anchor && !anchor.textExact && anchor.headingSlug) slugs.add(anchor.headingSlug);
    }
    if (!container || slugs.size === 0) {
      setMissingHeadings((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const present = new Set(Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR), (h) => h.id));
    const missing = new Set(Array.from(slugs).filter((slug) => !present.has(slug)));
    // Keep the previous Set identity when nothing changed, so consumers' memos stay stable.
    setMissingHeadings((prev) => (prev.size === missing.size && Array.from(missing).every((slug) => prev.has(slug)) ? prev : missing));
  }, [comments, containerRef, contentKey]);

  return useMemo(() => {
    const health = new Map<string, AnchorHealth>();
    const unresolved = new Set(unresolvedMarks);
    for (const comment of comments) {
      const anchor = comment.docAnchor;
      if (anchor?.textExact) {
        health.set(comment.name, unresolved.has(comment.name) ? "orphan" : "ok");
      } else if (anchor?.headingSlug) {
        health.set(comment.name, missingHeadings.has(anchor.headingSlug) ? "orphan" : "ok");
      } else {
        health.set(comment.name, "ok");
      }
    }
    return health;
  }, [comments, unresolvedMarks, missingHeadings]);
};
