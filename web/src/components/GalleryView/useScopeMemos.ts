import { useMemo } from "react";
import { isHomeDocument } from "@/hooks/useHomeDocument";
import { useMemos } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { type GalleryScope, resolveScopeWorkspaces } from "./types";

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
