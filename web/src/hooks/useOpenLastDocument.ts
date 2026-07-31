import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/routes";
import useCurrentUser from "./useCurrentUser";
import { useLastOpened } from "./useLastOpened";
import { fetchWorkspaces, workspaceKeys } from "./useWorkspaceQueries";

// URLs carry the bare UID, not the `memos/{uid}` resource name used internally.
const memoUid = (memoName: string) => memoName.replace(/^memos\//, "");

/**
 * Navigates to the document the user was last reading, as remembered server-side by the
 * LAST_OPENED user setting: `/{workspace title}/{doc uid}`. This is what the logo does from
 * anywhere outside the Notebook — it's the way back into the document you left.
 *
 * Degrades in steps rather than failing: no remembered document → the workspace's own URL (the
 * Notebook then opens its first document); no remembered workspace → the first one; no
 * workspaces at all (or the lookup failed) → the Home page.
 */
export function useOpenLastDocument() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const { getLastOpened } = useLastOpened(currentUser?.name);

  return useCallback(async () => {
    let workspaces: Awaited<ReturnType<typeof fetchWorkspaces>> = [];
    let lastOpened: Awaited<ReturnType<typeof getLastOpened>>;
    try {
      [workspaces, lastOpened] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: workspaceKeys.lists(),
          queryFn: fetchWorkspaces,
          // A click is not a reason to re-list workspaces the app just loaded.
          staleTime: 30_000,
        }),
        getLastOpened(),
      ]);
    } catch {
      navigate(ROUTES.DASHBOARD);
      return;
    }

    if (workspaces.length === 0) {
      navigate(ROUTES.DASHBOARD);
      return;
    }

    const workspace = workspaces.find((w) => w.name === lastOpened?.workspace) ?? workspaces[0];
    const memo = lastOpened?.workspaceMemos[workspace.name];
    const workspacePath = `/${encodeURIComponent(workspace.title)}`;
    navigate(memo ? `${workspacePath}/${encodeURIComponent(memoUid(memo))}` : workspacePath);
  }, [navigate, queryClient, getLastOpened]);
}
