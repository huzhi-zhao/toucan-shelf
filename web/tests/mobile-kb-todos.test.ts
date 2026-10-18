import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { groupKbTodos, isRootTodoDoc } from "@/mobile/lib/kbTodos";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const memo = (name: string, workspace: string, content: string, extra: Record<string, unknown> = {}) =>
  create(MemoSchema, {
    name,
    workspace,
    title: "TODO",
    folderPath: "",
    content,
    updateTime: timestampFromDate(new Date("2026-10-01")),
    ...extra,
  });

const workspaces = [
  { name: "workspaces/a", title: "A" },
  { name: "workspaces/b", title: "B" },
];

describe("isRootTodoDoc", () => {
  it("takes only the TODO document at a knowledge base's root", () => {
    expect(isRootTodoDoc({ title: "TODO", folderPath: "", parent: "" })).toBe(true);
    expect(isRootTodoDoc({ title: "todo.md", folderPath: "", parent: "" })).toBe(true);
    expect(isRootTodoDoc({ title: "TODO", folderPath: "agents", parent: "" })).toBe(false);
    expect(isRootTodoDoc({ title: "TODO", folderPath: "_sub/x", parent: "memos/x" })).toBe(false);
    expect(isRootTodoDoc({ title: "发布清单", folderPath: "", parent: "" })).toBe(false);
  });
});

describe("groupKbTodos", () => {
  it("lists only empty boxes, outside code blocks", () => {
    const content = ["- [ ] write", "- [x] done", "- [>] later", "* [ ] star bullet", "```calendar", "- [ ] not a task", "```"].join("\n");
    const groups = groupKbTodos([memo("memos/1", "workspaces/a", content)], workspaces);
    expect(groups).toEqual([{ workspace: "workspaces/a", title: "A", memo: "memos/1", todos: ["write", "star bullet"] }]);
  });

  it("ignores task lists elsewhere in a knowledge base", () => {
    const groups = groupKbTodos(
      [
        memo("memos/plan", "workspaces/a", "- [ ] agent step", { title: "实施计划" }),
        memo("memos/deep", "workspaces/a", "- [ ] nested", { folderPath: "agents" }),
        memo("memos/todo", "workspaces/b", "- [ ] mine"),
      ],
      workspaces,
    );
    expect(groups.map((g) => [g.title, g.todos])).toEqual([["B", ["mine"]]]);
  });

  it("keeps shelf order and leaves out hidden knowledge bases", () => {
    const groups = groupKbTodos(
      [
        memo("memos/b", "workspaces/b", "- [ ] y"),
        memo("memos/a", "workspaces/a", "- [ ] x"),
        memo("memos/h", "workspaces/hidden", "- [ ] z"),
      ],
      workspaces,
    );
    expect(groups.map((g) => g.title)).toEqual(["A", "B"]);
  });
});
