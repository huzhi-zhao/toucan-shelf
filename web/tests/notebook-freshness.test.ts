import { describe, expect, it } from "vitest";
import { buildFreshnessMap, freshnessKey } from "@/components/Notebook/notebookFreshness";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

const NOW = 1_700_000_000;
const HOUR = 3600;
const DAY = 24 * HOUR;

function doc(uid: string, ageSeconds: number, path = uid): WorkspaceTreeNode {
  return {
    type: WorkspaceTreeNode_NodeType.DOCUMENT,
    name: uid,
    path,
    memo: `memos/${uid}`,
    archived: false,
    docType: "MARKDOWN",
    children: [],
    updateTime: { seconds: BigInt(NOW - ageSeconds), nanos: 0 },
  } as unknown as WorkspaceTreeNode;
}

function folder(path: string, children: WorkspaceTreeNode[]): WorkspaceTreeNode {
  return {
    type: WorkspaceTreeNode_NodeType.FOLDER,
    name: path.split("/").pop() ?? path,
    path,
    memo: "",
    archived: false,
    docType: "",
    children,
  } as unknown as WorkspaceTreeNode;
}

describe("buildFreshnessMap", () => {
  it("assigns a tier per document age and leaves stale documents out", () => {
    const nodes = [doc("a", 10 * 60), doc("b", 5 * HOUR), doc("c", 2 * DAY), doc("d", 5 * DAY), doc("e", 30 * DAY)];
    const map = buildFreshnessMap(nodes, NOW);
    expect(map.get(freshnessKey(nodes[0]))).toBe(3);
    expect(map.get(freshnessKey(nodes[1]))).toBe(2);
    expect(map.get(freshnessKey(nodes[2]))).toBe(1);
    // Anything past three days is no longer decorated at all.
    expect(map.has(freshnessKey(nodes[3]))).toBe(false);
    expect(map.has(freshnessKey(nodes[4]))).toBe(false);
  });

  it("does not decorate documents just past the three-day boundary", () => {
    const nodes = [doc("edge-in", 3 * DAY - 60), doc("edge-out", 3 * DAY + 60)];
    const map = buildFreshnessMap(nodes, NOW);
    expect(map.get(freshnessKey(nodes[0]))).toBe(1);
    expect(map.has(freshnessKey(nodes[1]))).toBe(false);
  });

  it("lifts the freshest descendant level onto every ancestor folder", () => {
    const deep = doc("deep", 10 * 60, "a/b/deep");
    const inner = folder("a/b", [deep, doc("older", 2 * DAY, "a/b/older")]);
    const outer = folder("a", [inner]);
    const map = buildFreshnessMap([outer], NOW);
    expect(map.get(freshnessKey(inner))).toBe(3);
    expect(map.get(freshnessKey(outer))).toBe(3);
  });

  it("leaves folders with no recent descendants uncolored", () => {
    const stale = folder("archive", [doc("x", 60 * DAY, "archive/x")]);
    const map = buildFreshnessMap([stale], NOW);
    expect(map.has(freshnessKey(stale))).toBe(false);
  });
});
