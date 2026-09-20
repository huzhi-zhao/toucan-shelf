import { extractMemoIdFromName } from "@/helpers/resource-names";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/**
 * Sub-documents: long-form content that belongs to a document without belonging
 * in its body.
 *
 * A sub-document is a child memo of the document it belongs to — the same
 * relation a comment uses, which is why both arrive together from
 * `listMemoComments`. What separates the two is where the child lives:
 *
 *     comment      = child memo, folder path outside the reserved prefix
 *     sub-document = child memo, folder path "_sub/<parent uid>"
 *
 * The path is deliberately the only discriminator — see
 * `server/router/api/v1/subdoc.go` for why there is no payload flag beside it,
 * and `docs/dev/requirements/knowledge-base/sub-documents.md` for the feature.
 */
export const SUB_DOC_FOLDER_PREFIX = "_sub";

/** The folder path every sub-document of `parentName` ("memos/{uid}") lives at. */
export const subDocFolderPath = (parentName: string): string => `${SUB_DOC_FOLDER_PREFIX}/${extractMemoIdFromName(parentName)}`;

/**
 * Whether a folder path addresses a sub-document. Only the exact
 * "_sub/<uid>" shape counts: a bare "_sub" or a deeper nesting is not a
 * sub-document path, matching the server's own reading.
 */
export const isSubDocFolderPath = (folderPath: string | undefined): boolean => {
  if (!folderPath?.startsWith(`${SUB_DOC_FOLDER_PREFIX}/`)) return false;
  const rest = folderPath.slice(SUB_DOC_FOLDER_PREFIX.length + 1);
  return rest.length > 0 && !rest.includes("/");
};

/** Whether this child memo is a sub-document rather than a comment. */
export const isSubDocument = (memo: Pick<Memo, "folderPath">): boolean => isSubDocFolderPath(memo.folderPath);

/**
 * Splits a parent's children into the two things they can be. Both come back
 * from the same `listMemoComments` call, and every surface that shows one must
 * exclude the other: a long sub-document rendered as a comment card is exactly
 * the noise this feature exists to remove.
 */
export const splitChildMemos = <T extends Pick<Memo, "folderPath">>(children: T[]): { comments: T[]; subDocs: T[] } => ({
  comments: children.filter((child) => !isSubDocument(child)),
  subDocs: children.filter((child) => isSubDocument(child)),
});
