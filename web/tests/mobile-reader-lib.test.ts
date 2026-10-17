import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { splitHighlights } from "@/mobile/lib/highlight";
import { addRecentRead, RECENT_LIMIT, type RecentRead, removeRecentRead } from "@/mobile/lib/recent";
import { bodyOpensWithTitle } from "@/mobile/lib/title";
import { countDocuments, findFolderChildren, folderName, parentFolderPath } from "@/mobile/lib/tree";
import { docRoute, folderPathFromSplat, folderRoute } from "@/mobile/routes";
import { WorkspaceTreeNode_NodeType, WorkspaceTreeNodeSchema } from "@/types/proto/api/v1/workspace_service_pb";

const read = (n: number): RecentRead => ({ memoName: `memos/${n}`, title: `doc ${n}`, icon: "", workspaceTitle: "kb" });

describe("recent reads", () => {
  it("puts the latest read first without duplicating it", () => {
    const list = addRecentRead([read(1), read(2)], read(2));
    expect(list.map((r) => r.memoName)).toEqual(["memos/2", "memos/1"]);
  });

  it("keeps at most RECENT_LIMIT entries", () => {
    let list: RecentRead[] = [];
    for (let i = 0; i < RECENT_LIMIT + 3; i++) list = addRecentRead(list, read(i));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].memoName).toBe(`memos/${RECENT_LIMIT + 2}`);
  });

  it("drops a document that can no longer be opened", () => {
    expect(removeRecentRead([read(1), read(2)], "memos/1").map((r) => r.memoName)).toEqual(["memos/2"]);
  });
});

describe("folder levels", () => {
  const doc = (name: string, path: string) => create(WorkspaceTreeNodeSchema, { type: WorkspaceTreeNode_NodeType.DOCUMENT, name, path, memo: `memos/${name}` });
  const folder = (name: string, path: string, children: ReturnType<typeof doc>[]) =>
    create(WorkspaceTreeNodeSchema, { type: WorkspaceTreeNode_NodeType.FOLDER, name, path, children });
  const tree = [folder("ops", "ops", [folder("db", "ops/db", [doc("disk", "ops/db")]), doc("deploy", "ops")]), doc("readme", "")];

  it("finds the children of a nested folder", () => {
    expect(findFolderChildren(tree, "")).toBe(tree);
    expect(findFolderChildren(tree, "ops/db")?.map((n) => n.name)).toEqual(["disk"]);
    expect(findFolderChildren(tree, "ops/missing")).toBeUndefined();
  });

  it("counts every document below a folder", () => {
    expect(countDocuments(tree[0])).toBe(2);
  });

  it("splits folder paths", () => {
    expect(parentFolderPath("ops/db")).toBe("ops");
    expect(parentFolderPath("ops")).toBe("");
    expect(folderName("ops/db")).toBe("db");
  });
});

describe("mobile routes", () => {
  it("encodes each folder segment on its own", () => {
    expect(folderRoute("workspaces/abc", "发布/a b")).toBe("/kb/abc/%E5%8F%91%E5%B8%83/a%20b");
    expect(folderRoute("workspaces/abc")).toBe("/kb/abc");
  });

  it("reads the folder path back from the router splat", () => {
    expect(folderPathFromSplat("发布/a b/")).toBe("发布/a b");
    expect(folderPathFromSplat(undefined)).toBe("");
  });

  it("addresses documents by uid", () => {
    expect(docRoute("memos/xyz")).toBe("/doc/xyz");
  });
});

describe("search highlights", () => {
  it("marks every occurrence, ignoring case", () => {
    expect(splitHighlights("Deploy and deploy", ["deploy"])).toEqual([
      { text: "Deploy", hit: true },
      { text: " and ", hit: false },
      { text: "deploy", hit: true },
    ]);
  });

  it("prefers the longer term where terms overlap", () => {
    expect(splitHighlights("回滚记录", ["回滚", "回滚记录"])).toEqual([{ text: "回滚记录", hit: true }]);
  });

  it("returns the text untouched without terms", () => {
    expect(splitHighlights("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
});

describe("page title", () => {
  it("detects a body that opens with its own title", () => {
    expect(bodyOpensWithTitle("# 部署与回滚\n\n正文", "部署与回滚")).toBe(true);
    expect(bodyOpensWithTitle('---\nreferences:\n  - "https://x.y"\n---\n\n# 部署与回滚\n', "部署与回滚")).toBe(true);
  });

  it("keeps the header title otherwise", () => {
    expect(bodyOpensWithTitle("正文先行\n# 部署与回滚", "部署与回滚")).toBe(false);
    expect(bodyOpensWithTitle("## 部署与回滚", "部署与回滚")).toBe(false);
    expect(bodyOpensWithTitle("# 别的标题", "部署与回滚")).toBe(false);
  });
});
