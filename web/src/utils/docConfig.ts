import type { DocConfig, Memo } from "@/types/proto/api/v1/memo_service_pb";

/**
 * Per-document *view* configuration — how the app frames a document, as opposed to what the
 * document says. It lives on the memo (`memo.docConfig`, stored in the memo payload).
 *
 * Frontmatter has no say in this, by design. Properties describe content (date, status, tags);
 * how the app renders a document is chrome that means nothing outside this app and has no
 * business travelling with an exported markdown file. There is deliberately no fallback to the
 * old `displayOutline` / `displayFilter` / `hidden` keys — a document's text never decides its
 * styling.
 *
 * Storing it off-content also keeps flipping a switch cheap: no content revision, no
 * `updatedTs` bump (so the freshness indicator stays honest), no memogit diff, and no
 * re-embedding.
 *
 * Reader preferences (reading density, for one) are a different axis entirely and live in
 * localStorage — see `readingDensity.ts`.
 */
export interface ResolvedDocConfig {
  /** Body spans the full width of its pane, rather than being capped to a reading measure. */
  fullWidth: boolean;
  /** The outline panel opens by default on a desktop viewport. */
  displayOutline: boolean;
  /** The left secondary sidebar (folder tree) stays expanded while this document is open. */
  displayFilter: boolean;
  /** The frontmatter properties panel renders above the body. */
  showProperties: boolean;
}

export const DEFAULT_DOC_CONFIG: ResolvedDocConfig = {
  fullWidth: true,
  displayOutline: true,
  displayFilter: true,
  showProperties: true,
};

/**
 * The effective configuration for a document: the stored value, else the app default. Every
 * stored field uses explicit presence, so a document whose author turned full width *off* is
 * distinguishable from one that was never configured.
 */
export function resolveDocConfig(config: DocConfig | undefined): ResolvedDocConfig {
  return {
    fullWidth: config?.fullWidth ?? DEFAULT_DOC_CONFIG.fullWidth,
    displayOutline: config?.displayOutline ?? DEFAULT_DOC_CONFIG.displayOutline,
    displayFilter: config?.displayFilter ?? DEFAULT_DOC_CONFIG.displayFilter,
    showProperties: config?.showProperties ?? DEFAULT_DOC_CONFIG.showProperties,
  };
}

/** Convenience wrapper for the common case of resolving straight off a memo. */
export function resolveMemoDocConfig(memo: Pick<Memo, "docConfig"> | undefined): ResolvedDocConfig {
  return resolveDocConfig(memo?.docConfig);
}
