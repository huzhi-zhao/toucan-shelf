import { describe, expect, it } from "vitest";
import { buildKanbanColumns, formatTaskValue, taskCustomEntries, UNGROUPED_KEY } from "@/components/MemoContent/kanban/columns";
import { parseKanbanBlock } from "@/components/MemoContent/kanban/parseKanbanBlock";

// Columns and their order are shared by the web board and the mobile reader's
// read-only preview (mobile-phase3.md §4), so both always show the same board.

const columnsOf = (yaml: string) => buildKanbanColumns(parseKanbanBlock(yaml)).map((c) => [c.key, c.tasks.map((t) => t.title)]);

describe("buildKanbanColumns", () => {
  it("puts statusOrder columns first, empty ones included, then others in first-seen order", () => {
    const yaml = `statusOrder: [todo, doing, done]
items:
  - { title: a, status: review }
  - { title: b, status: todo }
  - { title: c, status: done }`;
    expect(columnsOf(yaml)).toEqual([
      ["todo", ["b"]],
      ["doing", []],
      ["done", ["c"]],
      ["review", ["a"]],
    ]);
  });

  it("collects tasks without the groupBy field in an ungrouped column", () => {
    const yaml = `items:
  - { title: a, status: todo }
  - { title: b }`;
    expect(columnsOf(yaml)).toEqual([
      ["todo", ["a"]],
      [UNGROUPED_KEY, ["b"]],
    ]);
  });

  it("groups by a custom field", () => {
    const yaml = `view: { groupBy: owner }
items:
  - { title: a, owner: amy }
  - { title: b, owner: bo }
  - { title: c, owner: amy }`;
    expect(columnsOf(yaml)).toEqual([
      ["amy", ["a", "c"]],
      ["bo", ["b"]],
    ]);
  });

  it("sorts by order by default, tasks without it last", () => {
    const yaml = `items:
  - { title: a, status: s }
  - { title: b, status: s, order: 2 }
  - { title: c, status: s, order: 1 }`;
    expect(columnsOf(yaml)).toEqual([["s", ["c", "b", "a"]]]);
  });

  it("sorts by the view's orderBy, descending when asked", () => {
    const yaml = `view: { orderBy: due, descending: true }
items:
  - { title: a, status: s, due: 2026-01-02 }
  - { title: b, status: s, due: 2026-01-03 }
  - { title: c, status: s, due: 2026-01-01 }`;
    expect(columnsOf(yaml)).toEqual([["s", ["b", "a", "c"]]]);
  });
});

describe("task details", () => {
  it("lists non-empty custom fields in source order and formats their values", () => {
    const [task] = parseKanbanBlock(`items:
  - { title: a, owner: amy, note: "", refs: [x, y], meta: { k: 1 } }`).tasks;
    expect(taskCustomEntries(task).map(([key, value]) => [key, formatTaskValue(value)])).toEqual([
      ["owner", "amy"],
      ["refs", "x, y"],
      ["meta", '{"k":1}'],
    ]);
  });
});
