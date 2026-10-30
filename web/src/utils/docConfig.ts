import type { BulletListStyleName } from "@/components/MemoContent/markdown/CardList";
import {
  type DocConfig,
  DocConfig_BulletListStyle,
  DocConfig_ReferenceSort,
  type Memo,
  Memo_DocType,
} from "@/types/proto/api/v1/memo_service_pb";

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
  /**
   * A single newline inside a paragraph is a soft wrap, as CommonMark specifies, rather than a
   * hard line break.
   *
   * Unlike its neighbours this one has no fixed app default: unset means "follow the author's
   * global preference" (`GeneralSetting.softBreakDefault`), which is what `softBreakDefault`
   * supplies to the resolvers below. The app-level fallback is hard breaks — the historical
   * behaviour, and the right one for a note somebody typed by hand.
   */
  softBreak: boolean;
  /**
   * How bullet lists render. Unset, unspecified or a style this client does not know yet (added by a newer
   * one) all render the plain list.
   */
  bulletListStyle: BulletListStyleName;
  /** How the References section orders sub-documents; unspecified keeps the server's order. */
  referenceSort: DocConfig_ReferenceSort;
  /** Whether that order runs in reverse. */
  referenceSortDescending: boolean;
}

export const DEFAULT_DOC_CONFIG: ResolvedDocConfig = {
  fullWidth: true,
  displayOutline: true,
  displayFilter: true,
  showProperties: true,
  softBreak: false,
  bulletListStyle: "plain",
  referenceSort: DocConfig_ReferenceSort.REFERENCE_SORT_UNSPECIFIED,
  referenceSortDescending: false,
};

const BULLET_LIST_STYLES: Partial<Record<DocConfig_BulletListStyle, BulletListStyleName>> = {
  [DocConfig_BulletListStyle.CARDS]: "cards",
};

/** The stored value for a bullet list style, for saving it back. */
export const bulletListStyleToProto = (style: BulletListStyleName): DocConfig_BulletListStyle =>
  style === "cards" ? DocConfig_BulletListStyle.CARDS : DocConfig_BulletListStyle.PLAIN;

/**
 * The effective configuration for a document: the stored value, else the app default. Every
 * stored field uses explicit presence, so a document whose author turned full width *off* is
 * distinguishable from one that was never configured.
 */
export function resolveDocConfig(config: DocConfig | undefined, softBreakDefault = DEFAULT_DOC_CONFIG.softBreak): ResolvedDocConfig {
  return {
    fullWidth: config?.fullWidth ?? DEFAULT_DOC_CONFIG.fullWidth,
    displayOutline: config?.displayOutline ?? DEFAULT_DOC_CONFIG.displayOutline,
    displayFilter: config?.displayFilter ?? DEFAULT_DOC_CONFIG.displayFilter,
    showProperties: config?.showProperties ?? DEFAULT_DOC_CONFIG.showProperties,
    softBreak: config?.softBreak ?? softBreakDefault,
    referenceSort: config?.referenceSort ?? DEFAULT_DOC_CONFIG.referenceSort,
    referenceSortDescending: config?.referenceSortDescending ?? DEFAULT_DOC_CONFIG.referenceSortDescending,
    bulletListStyle:
      (config?.bulletListStyle !== undefined && BULLET_LIST_STYLES[config.bulletListStyle]) || DEFAULT_DOC_CONFIG.bulletListStyle,
  };
}

/** Convenience wrapper for the common case of resolving straight off a memo. */
export function resolveMemoDocConfig(
  memo: Pick<Memo, "docConfig"> | undefined,
  softBreakDefault = DEFAULT_DOC_CONFIG.softBreak,
): ResolvedDocConfig {
  return resolveDocConfig(memo?.docConfig, softBreakDefault);
}

// The order document types are listed in when sorting by type.
const DOC_TYPE_ORDER = [Memo_DocType.MARKDOWN, Memo_DocType.HTML, Memo_DocType.PDF, Memo_DocType.VIEW];

type SortableDoc = Pick<Memo, "title" | "docType" | "createTime" | "updateTime">;

const seconds = (time: SortableDoc["createTime"]) => (time ? Number(time.seconds) : 0);
const byTitle = (a: SortableDoc, b: SortableDoc) => a.title.localeCompare(b.title, undefined, { numeric: true });
// A type this list does not know sorts last.
const typeRank = (doc: SortableDoc) => {
  const index = DOC_TYPE_ORDER.indexOf(doc.docType);
  return index === -1 ? DOC_TYPE_ORDER.length : index;
};

const COMPARATORS: Partial<Record<DocConfig_ReferenceSort, (a: SortableDoc, b: SortableDoc) => number>> = {
  [DocConfig_ReferenceSort.CREATED]: (a, b) => seconds(a.createTime) - seconds(b.createTime) || byTitle(a, b),
  [DocConfig_ReferenceSort.UPDATED]: (a, b) => seconds(a.updateTime) - seconds(b.updateTime) || byTitle(a, b),
  [DocConfig_ReferenceSort.TITLE]: byTitle,
  [DocConfig_ReferenceSort.TYPE]: (a, b) => typeRank(a) - typeRank(b) || byTitle(a, b),
};

/**
 * A document's sub-documents in the order its configuration asks for. Unspecified, or a key this client does
 * not know, keeps the order they came in. Ties fall back to the title.
 */
export function sortSubDocs<T extends SortableDoc>(subDocs: T[], sort: DocConfig_ReferenceSort, descending: boolean): T[] {
  const compare = COMPARATORS[sort];
  if (!compare) return subDocs;
  const sorted = [...subDocs].sort(compare);
  return descending ? sorted.reverse() : sorted;
}
