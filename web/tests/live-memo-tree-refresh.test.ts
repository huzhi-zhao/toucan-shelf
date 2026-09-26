import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { handleSSEEvent } from "@/hooks/useLiveMemoRefresh";
import { workspaceKeys } from "@/hooks/useWorkspaceQueries";

describe("live memo tree refresh", () => {
  it("invalidates the workspace tree when a document changes outside this tab", () => {
    const client = new QueryClient();
    const treeKey = workspaceKeys.tree("workspaces/career", false);
    client.setQueryData(treeKey, [{ memo: "memos/c01", updateTime: { seconds: 1n } }]);

    handleSSEEvent({ type: "memo.updated", name: "memos/c01" }, client);

    expect(client.getQueryState(treeKey)?.isInvalidated).toBe(true);
  });

  it("does not refetch the document tree for a comment edit", () => {
    const client = new QueryClient();
    const treeKey = workspaceKeys.tree("workspaces/career", false);
    client.setQueryData(treeKey, [{ memo: "memos/c01" }]);

    handleSSEEvent({ type: "memo.updated", name: "memos/comment", parent: "memos/c01" }, client);

    expect(client.getQueryState(treeKey)?.isInvalidated).toBe(false);
  });
});
