import { describe, expect, it } from "vitest";
import { resolveSortField, resolveSortOrder, sortTree } from "@/components/Notebook/notebookSort";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

// Minimal stand-ins: sortTree only ever reads type/name/children/times and the
// two override fields, so building the full generated message would only add noise.
const doc = (name: string, createSeconds: number): WorkspaceTreeNode =>
  ({
    type: WorkspaceTreeNode_NodeType.DOCUMENT,
    name,
    path: name,
    children: [],
    createTime: { seconds: BigInt(createSeconds) },
    updateTime: { seconds: BigInt(createSeconds) },
    sortField: "",
    sortOrder: "",
  }) as unknown as WorkspaceTreeNode;

const folder = (name: string, children: WorkspaceTreeNode[], sortField = "", sortOrder = ""): WorkspaceTreeNode =>
  ({
    type: WorkspaceTreeNode_NodeType.FOLDER,
    name,
    path: name,
    children,
    sortField,
    sortOrder,
    createTime: { seconds: BigInt(0) },
    updateTime: { seconds: BigInt(0) },
  }) as unknown as WorkspaceTreeNode;

const names = (nodes: WorkspaceTreeNode[]) => nodes.map((n) => n.name);

describe("resolveSortField / resolveSortOrder", () => {
  it("prefers the folder's own override", () => {
    expect(resolveSortField("alphabetical", "createTime")).toBe("alphabetical");
    expect(resolveSortOrder("asc", "desc")).toBe("asc");
  });

  it("treats empty as inherit", () => {
    expect(resolveSortField("", "updateTime")).toBe("updateTime");
    expect(resolveSortOrder("", "asc")).toBe("asc");
  });

  // Falling back to the global default here would break inheritance for the whole
  // subtree below, which is a much worse failure than honouring a stale value.
  it("treats an unrecognized override as inherit, not as the default", () => {
    expect(resolveSortField("byVibes", "updateTime")).toBe("updateTime");
    expect(resolveSortOrder("sideways", "asc")).toBe("asc");
  });
});

describe("sortTree", () => {
  it("applies the workspace rule to a folder that sets nothing", () => {
    const tree = [folder("plain", [doc("b", 20), doc("a", 10)])];
    const sorted = sortTree(tree, "createTime", "desc");
    expect(names(sorted[0].children)).toEqual(["b", "a"]);
  });

  // The case the feature exists for: the base sorts by time, one folder by name.
  it("lets one folder override the workspace rule without touching its siblings", () => {
    // Identical contents on both sides, so the only thing separating the two
    // results is the override: zebra is the newer document but sorts last by name.
    const tree = [
      folder("byName", [doc("zebra", 20), doc("apple", 10)], "alphabetical", "asc"),
      folder("byTime", [doc("zebra", 20), doc("apple", 10)]),
    ];
    const sorted = sortTree(tree, "createTime", "desc");
    expect(names(sorted[0].children)).toEqual(["apple", "zebra"]);
    expect(names(sorted[1].children)).toEqual(["zebra", "apple"]);
  });

  it("passes a folder's rule down to descendants that set none of their own", () => {
    const tree = [folder("outer", [folder("inner", [doc("zebra", 10), doc("apple", 20)])], "alphabetical", "asc")];
    const sorted = sortTree(tree, "createTime", "desc");
    expect(names(sorted[0].children[0].children)).toEqual(["apple", "zebra"]);
  });

  it("lets a descendant override what it inherits", () => {
    // inner's own createTime/desc has to beat both what outer says (alphabetical)
    // and what the workspace says (createTime/asc) — the three disagree on purpose.
    const tree = [
      folder("outer", [folder("inner", [doc("zebra", 20), doc("apple", 10)], "createTime", "desc")], "alphabetical", "asc"),
    ];
    const sorted = sortTree(tree, "createTime", "asc");
    expect(names(sorted[0].children[0].children)).toEqual(["zebra", "apple"]);
  });

  // A folder's override governs what is inside it; where the folder itself lands
  // among its siblings is the enclosing level's decision.
  it("does not let a folder's override change its own position among siblings", () => {
    const tree = [folder("older", [], "alphabetical", "asc"), folder("newer", [])];
    tree[0] = { ...tree[0], createTime: { seconds: BigInt(10) } } as WorkspaceTreeNode;
    tree[1] = { ...tree[1], createTime: { seconds: BigInt(20) } } as WorkspaceTreeNode;
    expect(names(sortTree(tree, "createTime", "desc"))).toEqual(["newer", "older"]);
  });

  it("keeps foldersFirst applying at every level", () => {
    const tree = [folder("root", [doc("a", 10), folder("sub", [])], "alphabetical", "asc")];
    const sorted = sortTree(tree, "createTime", "desc", true);
    expect(names(sorted[0].children)).toEqual(["sub", "a"]);
  });
});
