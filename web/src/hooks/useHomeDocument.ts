import { create } from "@bufbuild/protobuf";
import { useEffect, useRef } from "react";
import { emptyHomeConfig, serializeHomeViewConfig } from "@/components/GalleryView/home";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import useCurrentUser from "./useCurrentUser";
import { useCreateMemo, useMemos } from "./useMemoQueries";
import { useWorkspaces } from "./useWorkspaceQueries";

/**
 * Reserved folder holding the Home document. Mirrors `HomeFolderPath` on the
 * server, which hides this folder from the workspace tree. Blocks scanning
 * across knowledge bases skip it too, so the Home configuration never appears
 * as a card on the Home page itself.
 */
export const HOME_FOLDER_PATH = ".home";

/** Title of the Home document inside `HOME_FOLDER_PATH`. */
export const HOME_DOC_TITLE = "Home";

/**
 * True for `viewer`'s own Home configuration document.
 *
 * The creator check is not redundant with the server's: the Home document is one
 * per user, and a listing that spans users — the team owner sees every knowledge
 * base — would otherwise let a stranger's Home document win the lookup below and
 * render their (usually empty) configuration in place of the viewer's.
 */
export function isHomeDocument(memo: Pick<Memo, "docType" | "folderPath" | "creator">, viewer?: string): boolean {
  if (memo.docType !== Memo_DocType.VIEW || memo.folderPath !== HOME_FOLDER_PATH) {
    return false;
  }
  return !viewer || memo.creator === viewer;
}

/**
 * Resolves the user's single Home document, creating it on first visit.
 *
 * It is an ordinary VIEW memo — so it gets the view editor, the block renderers
 * and the update API for free — parked in a reserved folder of the user's first
 * knowledge base. VIEW documents are already excluded from content feeds
 * (`FEED_EXCLUDED_DOC_TYPES`), and the reserved folder keeps it out of the
 * notebook tree.
 */
export function useHomeDocument(defaultSectionTitle: string): { memo?: Memo; isLoading: boolean } {
  const currentUser = useCurrentUser();
  const { data: workspaces = [], isLoading: workspacesLoading } = useWorkspaces();
  // VIEW documents are few, so listing them all and picking the Home one out is
  // cheaper than teaching the memo filter grammar about folder paths.
  const { data, isLoading: memosLoading } = useMemos({ pageSize: 1000, state: State.NORMAL, filter: `doc_type == "VIEW"` });
  const createMemo = useCreateMemo();
  const creating = useRef(false);

  const memo = data?.memos.find((m) => isHomeDocument(m, currentUser?.name));
  const isLoading = workspacesLoading || memosLoading;
  const homeWorkspace = workspaces[0]?.name;

  useEffect(() => {
    if (isLoading || memo || !homeWorkspace || creating.current) return;
    creating.current = true;
    createMemo
      .mutateAsync(
        create(MemoSchema, {
          workspace: homeWorkspace,
          folderPath: HOME_FOLDER_PATH,
          title: HOME_DOC_TITLE,
          docType: Memo_DocType.VIEW,
          content: serializeHomeViewConfig(emptyHomeConfig(defaultSectionTitle)),
        }),
      )
      .catch(() => {
        // Leave the flag set: a failed creation retries on the next mount rather
        // than looping here, so a persistent server error can't spin the page.
      });
  }, [isLoading, memo, homeWorkspace, createMemo, defaultSectionTitle]);

  return { memo, isLoading: isLoading || (!memo && Boolean(homeWorkspace)) };
}
