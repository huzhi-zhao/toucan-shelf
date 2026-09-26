import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FileTreeNode from "@/components/Notebook/FileTreeNode";
import { buildFreshnessMap } from "@/components/Notebook/notebookFreshness";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

const node = {
  type: WorkspaceTreeNode_NodeType.DOCUMENT,
  name: "Recently edited",
  path: "decisions/c01",
  memo: "memos/c01",
  archived: false,
  docType: "MARKDOWN",
  children: [],
  updateTime: { seconds: BigInt(1_700_000_000 - 60), nanos: 0 },
} as unknown as WorkspaceTreeNode;

describe("selected document freshness", () => {
  it("keeps the green update tint on the open document", async () => {
    render(
      <FileTreeNode
        node={node}
        depth={0}
        selectedMemo={node.memo}
        freshness={buildFreshnessMap([node], 1_700_000_000)}
        onSelectDocument={vi.fn()}
        onRenameFolder={vi.fn()}
        onMoveFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onNewDocumentIn={vi.fn()}
        onNewViewIn={vi.fn()}
        onNewBlogViewIn={vi.fn()}
        onNewFolderIn={vi.fn()}
        onUploadIn={vi.fn()}
        onUploadPdfIn={vi.fn()}
      />,
    );

    expect(await screen.findByText("Recently edited")).toHaveClass("text-emerald-600");
  });
});
