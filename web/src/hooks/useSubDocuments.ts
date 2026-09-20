import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { memoServiceClient } from "@/connect";
import { memoKeys } from "@/hooks/useMemoQueries";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { subDocFolderPath } from "@/utils/subDoc";

/**
 * Strips a filename down to the title a sub-document should carry. Titles in
 * this app never hold an extension (a document called "plan.md" is literally
 * named "plan.md"), and an uploaded `notes.md` is meant to become a document
 * called "notes".
 */
export const titleFromFilename = (filename: string): string => filename.replace(/\.(md|markdown|txt)$/i, "").trim();

/**
 * Creating and reading a document's sub-documents.
 *
 * There is no dedicated endpoint for either: a sub-document is created with the
 * ordinary CreateMemo, addressed by the reserved folder path that binds it to
 * its parent, and it is read back with the same listMemoComments call the
 * comment panel already makes (both are child memos). See
 * `docs/dev/requirements/knowledge-base/sub-documents.md`.
 */
export function useSubDocuments(parentMemoName: string) {
  const queryClient = useQueryClient();

  // Both panels read one list, so a new sub-document has to invalidate the
  // comment query — that is where it will arrive from.
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: memoKeys.comments(parentMemoName) });
  }, [queryClient, parentMemoName]);

  const createSubDoc = useCallback(
    async (title: string, content = ""): Promise<Memo> => {
      const subDoc = await memoServiceClient.createMemo({
        memo: create(MemoSchema, {
          // The path is the binding: the server reads the parent out of it and
          // builds the relation, inheriting the parent's knowledge base and
          // visibility. Nothing else here says which document this belongs to.
          folderPath: subDocFolderPath(parentMemoName),
          title,
          content,
        }),
      });
      invalidate();
      return subDoc;
    },
    [parentMemoName, invalidate],
  );

  const createSubDocFromFile = useCallback(
    async (file: File): Promise<Memo> => {
      const content = await file.text();
      return createSubDoc(titleFromFilename(file.name) || file.name, content);
    },
    [createSubDoc],
  );

  return { createSubDoc, createSubDocFromFile, invalidate };
}
