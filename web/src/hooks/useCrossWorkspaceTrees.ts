import { useQuery } from "@tanstack/react-query";
import { workspaceServiceClient } from "@/connect";
import type { WorkspaceTreeByTitle } from "@/types/proto/api/v1/workspace_service_pb";

/**
 * Prefetches the knowledge-base trees a document's cross-workspace links
 * (`@库标题/路径`) need, keyed by lower-cased title.
 *
 * Prefetching rather than making the resolver async is a deliberate design
 * choice (see docs/dev/design/20260829-relative-and-cross-workspace-refs.md,
 * R2.3): `DocumentLinkContextValue.resolve` is called during render by every
 * link, embed and grid card, and making it async would push a loading state
 * into all of them.
 *
 * `undefined` for a title means "not fetched yet"; an entry with
 * `available === false` means the knowledge base does not exist *or* the reader
 * may not open it — the server returns those two identically on purpose.
 */
export const crossWorkspaceTreeKeys = {
  all: ["cross-workspace-trees"] as const,
  forTitles: (titles: string[]) => [...crossWorkspaceTreeKeys.all, [...titles].sort()] as const,
};

export type CrossWorkspaceTrees = Map<string, WorkspaceTreeByTitle>;

const EMPTY: CrossWorkspaceTrees = new Map();

export function useCrossWorkspaceTrees(titles: string[]): CrossWorkspaceTrees {
  const { data } = useQuery({
    queryKey: crossWorkspaceTreeKeys.forTitles(titles),
    queryFn: async () => {
      const { workspaces } = await workspaceServiceClient.batchGetWorkspaceTreesByTitle({ titles });
      const map: CrossWorkspaceTrees = new Map();
      for (const entry of workspaces) {
        map.set(entry.requestedTitle.trim().toLowerCase(), entry);
      }
      return map;
    },
    enabled: titles.length > 0,
    // Trees change when documents move; a short window is enough to keep one
    // page's links consistent without re-fetching per link.
    staleTime: 30_000,
  });
  return data ?? EMPTY;
}
