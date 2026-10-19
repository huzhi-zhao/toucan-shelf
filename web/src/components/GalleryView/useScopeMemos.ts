import { useMemo } from "react";
import { isHomeDocument } from "@/hooks/useHomeDocument";
import { useMemos } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { calendarDocsByDate } from "./calendar";
import { sortDocs } from "./cards";
import { matchesScope, propertyMap } from "./fields";
import { type CalendarLayoutBlock, type GalleryBlock, type GalleryScope, resolveScopeWorkspaces } from "./types";

/**
 * The candidate documents a block's scope may match: every normal document in
 * the knowledge bases the scope selects. Blocks then apply their own rules
 * (`matchesScope`) to this list. Ordinary VIEW documents select nothing, which
 * resolves to the view's own workspace — the behavior before Home existed.
 */
export function useScopeMemos(scope: GalleryScope, ownWorkspace: string): { memos: Memo[]; isLoading: boolean } {
  const { filter, allowed } = resolveScopeWorkspaces(scope, ownWorkspace);
  const { data, isLoading } = useMemos({ pageSize: 1000, state: State.NORMAL, ...(filter ? { filter } : {}) });
  // Memoized on the selection's contents rather than on the derived `allowed`
  // set: callers re-parse their config on every render, so both the scope object
  // and the set built from it are new each time.
  const selectionKey = (scope.workspaces ?? []).join(",");
  const memos = useMemo(() => {
    // The Home document is configuration, not content: never let a block's
    // scope surface it as a card (it is reachable through the sidebar only).
    const list = (data?.memos ?? []).filter((m) => !isHomeDocument(m));
    return allowed ? list.filter((m) => allowed.has(m.workspace)) : list;
  }, [data, selectionKey]);
  return { memos, isLoading };
}

/**
 * The documents a gallery block shows, in card order: its scope's candidates
 * that match the block's rules, minus the view itself, sorted by the block.
 */
export function useGalleryDocs(block: GalleryBlock, view: Memo): { docs: Memo[]; isLoading: boolean } {
  const { memos, isLoading } = useScopeMemos(block.scope, view.workspace);
  const docs = useMemo(() => {
    // VIEW docs are eligible too: they now carry frontmatter properties, so a
    // gallery can filter, sort and reference other views like any other doc.
    const ctx = { viewFolderPath: view.folderPath };
    const list = memos.filter((m) => m.name !== view.name && matchesScope(m, propertyMap(m.content), block.scope, ctx));
    return sortDocs(list, block);
  }, [memos, block, view.name, view.folderPath]);
  return { docs, isLoading };
}

/** The documents a calendar layout block shows, bucketed by the day each lands on (see `calendarDocsByDate`). */
export function useCalendarDocs(block: CalendarLayoutBlock, view: Memo): { docsByDate: Map<string, Memo[]>; isLoading: boolean } {
  const { memos, isLoading } = useScopeMemos(block.scope, view.workspace);
  const docsByDate = useMemo(() => calendarDocsByDate(memos, block, view), [memos, block, view.name, view.folderPath]);
  return { docsByDate, isLoading };
}
