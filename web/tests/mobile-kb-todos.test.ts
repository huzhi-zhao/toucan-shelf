import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { groupKbTodos } from "@/mobile/lib/kbTodos";
import { Memo_DocType, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const memo = (name: string, workspace: string, content: string, updated: string, extra: Record<string, unknown> = {}) =>
  create(MemoSchema, {
    name,
    workspace,
    title: name,
    content,
    docType: Memo_DocType.MARKDOWN,
    updateTime: timestampFromDate(new Date(updated)),
    ...extra,
  });

const workspaces = [
  { name: "workspaces/a", title: "A" },
  { name: "workspaces/b", title: "B" },
];

describe("groupKbTodos", () => {
  it("lists only empty boxes, outside code blocks", () => {
    const content = ["- [ ] write", "- [x] done", "- [>] later", "* [ ] star bullet", "```calendar", "- [ ] not a task", "```"].join("\n");
    const groups = groupKbTodos([memo("memos/1", "workspaces/a", content, "2026-10-01")], workspaces);
    expect(groups).toHaveLength(1);
    expect(groups[0].docs[0].todos).toEqual(["write", "star bullet"]);
    expect(groups[0].docs[0].docType).toBe("MARKDOWN");
  });

  it("groups by knowledge base in shelf order, newest document first", () => {
    const groups = groupKbTodos(
      [
        memo("memos/old", "workspaces/b", "- [ ] x", "2026-10-01"),
        memo("memos/new", "workspaces/b", "- [ ] y", "2026-10-02"),
        memo("memos/a1", "workspaces/a", "- [ ] z", "2026-09-01"),
      ],
      workspaces,
    );
    expect(groups.map((g) => g.title)).toEqual(["A", "B"]);
    expect(groups[1].docs.map((d) => d.memo)).toEqual(["memos/new", "memos/old"]);
  });

  it("leaves out hidden knowledge bases, comments and documents with nothing left", () => {
    const groups = groupKbTodos(
      [
        memo("memos/hidden", "workspaces/hidden", "- [ ] x", "2026-10-01"),
        memo("memos/comment", "workspaces/a", "- [ ] x", "2026-10-01", { parent: "memos/p", folderPath: "" }),
        memo("memos/sub", "workspaces/a", "- [ ] sub", "2026-10-01", { parent: "memos/p", folderPath: "_sub/p" }),
        memo("memos/done", "workspaces/a", "- [x] x\n- [ ] ", "2026-10-01"),
      ],
      workspaces,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].docs.map((d) => d.memo)).toEqual(["memos/sub"]);
  });
});
