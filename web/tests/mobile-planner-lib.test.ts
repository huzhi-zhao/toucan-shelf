import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  buildCalendarData,
  convertCalendarBlock,
  groupOpenTodos,
  IMPORT_CANCEL_REASON,
  isDateEditable,
  isOverdue,
  localToday,
  monthRange,
  readCalendarView,
  saveCalendarView,
  postponeChoices,
  todosForDay,
  todosNotShown,
} from "@/mobile/lib/planner";
import { todoNameFromUid, todoRoute } from "@/mobile/routes";
import {
  CheckInSchema,
  HabitSchema,
  ListPlannerEntriesResponseSchema,
  PlannerNoteSchema,
  type Todo,
  Todo_Status,
  TodoSchema,
} from "@/types/proto/api/v1/planner_service_pb";

const todo = (title: string, date: string, status = Todo_Status.ACTIVE): Todo =>
  create(TodoSchema, { name: `planner/todos/${title}`, title, date, status });

describe("dates", () => {
  it("formats the phone's local day", () => {
    expect(localToday(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
  });

  it("covers a month grid's spill-over days", () => {
    expect(monthRange({ year: 2026, month: 9 })).toEqual({ startDate: "2026-09-24", endDate: "2026-11-07" });
  });

  it("calls only an active, dated todo before today overdue", () => {
    expect(isOverdue(todo("a", "2026-10-16"), "2026-10-17")).toBe(true);
    expect(isOverdue(todo("a", "2026-10-17"), "2026-10-17")).toBe(false);
    expect(isOverdue(todo("a", ""), "2026-10-17")).toBe(false);
    expect(isOverdue(todo("a", "2026-10-16", Todo_Status.DONE), "2026-10-17")).toBe(false);
  });

  it("offers tomorrow, the day after and next Monday to postpone to", () => {
    // 2026-10-17 is a Saturday.
    expect(postponeChoices("2026-10-17", "2026-10-15")).toEqual([
      { choice: "tomorrow", date: "2026-10-18" },
      { choice: "dayAfterTomorrow", date: "2026-10-19" },
    ]);
    // A Wednesday: next Monday is five days on; the todo's own date is left out.
    expect(postponeChoices("2026-10-14", "2026-10-15").map((c) => c.choice)).toEqual(["dayAfterTomorrow", "nextMonday"]);
    // On a Monday, next Monday is a week away.
    expect(postponeChoices("2026-10-19", "2026-10-19").at(-1)).toEqual({ choice: "nextMonday", date: "2026-10-26" });
  });

  it("keeps old days read-only past the limit, and none with 0", () => {
    expect(isDateEditable("2026-10-11", "2026-10-17", 7)).toBe(true);
    expect(isDateEditable("2026-10-10", "2026-10-17", 7)).toBe(false);
    expect(isDateEditable("2020-01-01", "2026-10-17", 0)).toBe(true);
  });
});

describe("todo lists", () => {
  it("groups open todos by date", () => {
    const groups = groupOpenTodos([todo("late", "2026-10-01"), todo("now", "2026-10-17"), todo("soon", "2026-10-20"), todo("any", "")], "2026-10-17");
    expect(groups.overdue.map((t) => t.title)).toEqual(["late"]);
    expect(groups.today.map((t) => t.title)).toEqual(["now"]);
    expect(groups.upcoming.map((t) => t.title)).toEqual(["soon"]);
    expect(groups.undated.map((t) => t.title)).toEqual(["any"]);
  });

  it("shows overdue todos on today, and only there", () => {
    const dated = [todo("now", "2026-10-17"), todo("past", "2026-10-10")];
    const open = [todo("late", "2026-10-01"), ...dated];
    expect(todosForDay("2026-10-17", "2026-10-17", dated, open).map((t) => t.title)).toEqual(["late", "past", "now"]);
    expect(todosForDay("2026-10-10", "2026-10-17", dated, open).map((t) => t.title)).toEqual(["past"]);
  });

  it("leaves out of the list what the selected day already shows", () => {
    const open = [todo("late", "2026-10-01"), todo("now", "2026-10-17"), todo("soon", "2026-10-20")];
    const shownToday = todosForDay("2026-10-17", "2026-10-17", [open[1]], open);
    expect(todosNotShown(open, shownToday).map((t) => t.title)).toEqual(["soon"]);
    const shownLater = todosForDay("2026-10-20", "2026-10-17", [open[2]], open);
    expect(todosNotShown(open, shownLater).map((t) => t.title)).toEqual(["late", "now"]);
  });

  it("round-trips a todo's detail route", () => {
    expect(todoRoute("planner/todos/abc")).toBe("/plan/todo/abc");
    expect(todoNameFromUid("abc")).toBe("planner/todos/abc");
  });
});

describe("calendar data", () => {
  it("draws check-ins as event dots, todos as tasks and notes as plain items", () => {
    const habits = [create(HabitSchema, { name: "planner/habits/a", title: "冥想" }), create(HabitSchema, { name: "planner/habits/b", title: "运动" })];
    const entries = create(ListPlannerEntriesResponseSchema, {
      checkIns: [create(CheckInSchema, { habit: "planner/habits/b", date: "2026-10-02", note: "走路" })],
      todos: [todo("作业", "2026-10-02", Todo_Status.DONE)],
      notes: [create(PlannerNoteSchema, { name: "planner/notes/n", date: "2026-10-02", content: "记一笔" })],
    });
    const data = buildCalendarData(habits, entries);
    expect(data.events).toEqual(["冥想", "运动"]);
    expect(data.eventsByDate["2026-10-02"]).toEqual(["运动"]);
    expect(data.itemCounts["2026-10-02"]).toBe(3);
    expect(data.itemsByDate["2026-10-02"]).toEqual([
      { text: "运动", isEvent: true, comment: "走路" },
      { text: "作业", marker: "x", checked: true },
      { text: "记一笔" },
    ]);
  });
});

describe("calendar block import", () => {
  const source = [
    "```calendar",
    "events: 🙏冥想,💪运动",
    "allowMaxUpdateDays: 7",
    "",
    "- 2026-10-17",
    "- [ ] 写作业",
    "",
    "- 2026-10-09",
    "",
    "- 2026-10-02",
    "- @2 走路7公里",
    "- 记了一件事",
    "",
    "- 2026-08-05",
    "- @1 意境",
    "- [x] 休息",
    "- [-] 念书",
    "- [>] 写报告",
    "- [!] 重要的事",
    "- @跑步",
    "- @跑步",
    "```",
  ].join("\n");

  it("converts each kind of line by the migration rules", () => {
    const { request, summary } = convertCalendarBlock(source);
    expect(summary).toEqual({ habits: 3, checkIns: 3, activeTodos: 1, doneTodos: 1, cancelledTodos: 3, notes: 1, skipped: 0 });

    // A name outside events: becomes a new habit, after the declared ones.
    expect(request.habits.map((h) => h.title)).toEqual(["🙏冥想", "💪运动", "跑步"]);
    expect(request.checkIns.map((c) => [c.habitIndex, c.date, c.note])).toEqual([
      [1, "2026-10-02", "走路7公里"],
      [0, "2026-08-05", "意境"],
      // An undeclared name becomes a habit; checked in twice on one day, it is one check-in.
      [2, "2026-08-05", ""],
    ]);
    expect(request.notes.map((n) => [n.date, n.content])).toEqual([["2026-10-02", "记了一件事"]]);

    const byTitle = new Map(request.todos.map((t) => [t.todo?.title, t]));
    expect(byTitle.get("写作业")?.todo?.status).toBe(Todo_Status.ACTIVE);
    expect(byTitle.get("休息")?.todo?.status).toBe(Todo_Status.DONE);
    expect(byTitle.get("休息")?.closedOverdue).toBe(false);
    for (const title of ["念书", "写报告", "重要的事"]) {
      const imported = byTitle.get(title);
      expect(imported?.todo?.status).toBe(Todo_Status.CANCELLED);
      expect(imported?.todo?.cancelReason).toBe(IMPORT_CANCEL_REASON);
      expect(imported?.closedOverdue).toBe(true);
    }
    expect(byTitle.get("重要的事")?.todo?.important).toBe(true);
  });

  it("skips items that have no date line above them", () => {
    const { summary } = convertCalendarBlock("events: a\n- [ ] 没有日期\n- 2026-10-01\n- [ ] 有日期");
    expect(summary.skipped).toBe(1);
    expect(summary.activeTodos).toBe(1);
  });
});

describe("calendar view memory", () => {
  it("keeps the day and month for the rest of the day, and starts over on a new one", () => {
    const view = { month: { year: 2026, month: 8 }, selectedDate: "2026-09-12", weekStartOverride: 7 };
    saveCalendarView(view, "2026-10-17");
    expect(readCalendarView("2026-10-17")).toMatchObject(view);
    expect(readCalendarView("2026-10-18")).toBeUndefined();
  });
});
