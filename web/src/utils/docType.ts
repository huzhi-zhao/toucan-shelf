/**
 * Which documents hold block JSON rather than a document body.
 *
 * `VIEW` composes live knowledge-base data; `BLOGVIEW` composes a published
 * site's home page out of publication snapshots. Their block vocabularies are
 * disjoint and their editors offer different menus — but everything structural
 * about them is the same (the content is JSON, there is no outline, no version
 * history, no feed entry), so those places ask this rather than naming one type.
 */

import { Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";

export function isLayoutDoc(docType: Memo_DocType | undefined): boolean {
  return docType === Memo_DocType.VIEW || docType === Memo_DocType.BLOGVIEW;
}

/** The same question against the workspace tree's raw doc-type strings. */
export function isLayoutDocTypeName(docType: string | undefined): boolean {
  return docType === "VIEW" || docType === "BLOGVIEW";
}

/** Which block vocabulary a layout document's editor should offer. */
export function viewVariantOf(docType: Memo_DocType | undefined): "library" | "site" {
  return docType === Memo_DocType.BLOGVIEW ? "site" : "library";
}
