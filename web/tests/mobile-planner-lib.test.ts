import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  buildCalendarData,
  convertCalendarBlock,
  exerciseSummary,
  formatReps,
  groupOpenTodos,
  habitTodoLabel,
  habitVersionOn,
  IMPORT_CANCEL_REASON,
  isDateEditable,
  isFailed,
  isOverdue,
  isSingleEmoji,
  joinHabitTitle,
  localToday,
  monthRange,
  parseAmount,
  parseReps,
  pinnedHabitNamesOn,
  postponeChoices,
  readCalendarView,
  saveCalendarView,
  splitHabitTitle,
  todosForDay,
  todosNotShown,
  weeklyCheckIns,
  weeklyGoalOn,
  weekRange,
} from "@/mobile/lib/planner";
import { todoNameFromUid, todoRoute } from "@/mobile/routes";
import {
  CheckInSchema,
  HabitSchema,
  type HabitVersion,
  HabitVersionSchema,
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
    const groups = groupOpenTodos(
      [todo("late", "2026-10-01"), todo("now", "2026-10-17"), todo("soon", "2026-10-20"), todo("any", "")],
      "2026-10-17",
    );
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
  it("draws check-ins as event dots, todos as tasks and notes as plain items, leaving habit todos out", () => {
    const habits = [
      create(HabitSchema, { name: "planner/habits/a", title: "冥想", color: 0 }),
      create(HabitSchema, { name: "planner/habits/b", title: "运动", color: 1 }),
    ];
    const versions = [version("", "planner/habits/a", "planner/habits/b")];
    const entries = create(ListPlannerEntriesResponseSchema, {
      checkIns: [create(CheckInSchema, { habit: "planner/habits/b", date: "2026-10-02", note: "走路" })],
      todos: [
        todo("作业", "2026-10-02", Todo_Status.DONE),
        create(TodoSchema, { name: "planner/todos/h", title: "运动 30 分钟", date: "2026-10-02", habit: "planner/habits/b" }),
      ],
      notes: [create(PlannerNoteSchema, { name: "planner/notes/n", date: "2026-10-02", content: "记一笔" })],
    });
    const data = buildCalendarData(habits, versions, entries, { startDate: "2026-09-24", endDate: "2026-11-07" });
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

const version = (effectiveDate: string, ...habits: string[]): HabitVersion =>
  create(HabitVersionSchema, { effectiveDate, entries: habits.map((habit, i) => ({ habit, weeklyGoal: i, pinned: i < 3 })) });

describe("habit versions", () => {
  const habits = ["a", "b", "c"].map((id, i) => create(HabitSchema, { name: `planner/habits/${id}`, title: id, color: i }));
  const versions = [version("", "planner/habits/a", "planner/habits/b"), version("2026-10-20", "planner/habits/c", "planner/habits/a")];

  it("uses the latest version effective on the day", () => {
    expect(habitVersionOn(versions, "2026-10-19")?.effectiveDate).toBe("");
    expect(habitVersionOn(versions, "2026-10-20")?.effectiveDate).toBe("2026-10-20");
    expect(habitVersionOn([version("2026-10-20")], "2026-10-19")).toBeUndefined();
    expect(weeklyGoalOn(versions, "planner/habits/a", "2026-10-21", 1)).toBe(1);
    expect(weeklyGoalOn(versions, "planner/habits/b", "2026-10-21", 1)).toBe(0);
  });

  it("measures a whole week against the plan in effect on its last day", () => {
    // The plan changed on Tuesday 10-20: from Monday, Monday 10-19 is in its week and takes the new goals too.
    expect(weeklyGoalOn(versions, "planner/habits/a", "2026-10-19", 1)).toBe(1);
    expect(weeklyGoalOn(versions, "planner/habits/b", "2026-10-19", 1)).toBe(0);
    // The week before keeps the old ones.
    expect(weeklyGoalOn(versions, "planner/habits/b", "2026-10-15", 1)).toBe(1);
    // From Tuesday, 10-19 ends the old plan's last week.
    expect(weeklyGoalOn(versions, "planner/habits/a", "2026-10-19", 2)).toBe(0);
    expect(weeklyGoalOn(versions, "planner/habits/b", "2026-10-19", 2)).toBe(1);
  });

  it("lays each day's dots out by its version, without gaps", () => {
    const data = buildCalendarData(habits, versions, undefined, { startDate: "2026-09-24", endDate: "2026-11-07" });
    expect(data.slotsOf("2026-10-19")).toEqual(["a", "b"]);
    expect(data.slotsOf("2026-10-20")).toEqual(["c", "a"]);
    expect(data.events).toEqual(["a", "b", "c"]);
    // A month after the change lists only the habits in use then.
    expect(buildCalendarData(habits, versions, undefined, { startDate: "2026-11-24", endDate: "2027-01-07" }).events).toEqual(["c", "a"]);
  });

  it("gives only pinned habits a place in a day's cell", () => {
    const folded = create(HabitVersionSchema, {
      effectiveDate: "",
      entries: [
        { habit: "planner/habits/a", pinned: false },
        { habit: "planner/habits/b", pinned: true },
      ],
    });
    expect(
      buildCalendarData(habits, [folded], undefined, { startDate: "2026-09-24", endDate: "2026-11-07" }).slotsOf("2026-10-19"),
    ).toEqual(["b"]);
    expect([...pinnedHabitNamesOn([folded], "2026-10-19")]).toEqual(["planner/habits/b"]);
  });

  it("counts a habit's check-ins in the week of a day", () => {
    expect(weekRange("2026-10-22", 1)).toEqual({ startDate: "2026-10-19", endDate: "2026-10-25" });
    expect(weekRange("2026-10-22", 7)).toEqual({ startDate: "2026-10-18", endDate: "2026-10-24" });
    const checkIns = ["2026-10-18", "2026-10-19", "2026-10-21"].map((date) => create(CheckInSchema, { habit: "planner/habits/a", date }));
    expect(weeklyCheckIns(checkIns, "planner/habits/a", "2026-10-22", 1)).toBe(2);
    expect(weeklyCheckIns(checkIns, "planner/habits/a", "2026-10-22", 7)).toBe(3);
    expect(habitTodoLabel("🚶", 3, 2)).toBe("🚶 3/2");
    expect(habitTodoLabel("🚶", 3, 0)).toBe("🚶");
  });

  it("fails a habit todo past its day instead of making it overdue", () => {
    const habitTodo = create(TodoSchema, { title: "走", date: "2026-10-16", status: Todo_Status.ACTIVE, habit: "planner/habits/a" });
    expect(isFailed(habitTodo, "2026-10-17")).toBe(true);
    expect(isOverdue(habitTodo, "2026-10-17")).toBe(false);
    expect(isFailed(habitTodo, "2026-10-16")).toBe(false);
    expect(isFailed(todo("plain", "2026-10-16"), "2026-10-17")).toBe(false);
  });
});

describe("workouts", () => {
  it("reads reps and amounts as typed", () => {
    expect(parseReps("15/12/12")).toEqual([15, 12, 12]);
    expect(parseReps(" 15, 20 ，40 ")).toEqual([15, 20, 40]);
    expect(parseReps("15/x/-1/")).toEqual([15]);
    expect(parseReps("")).toEqual([]);
    expect(formatReps([15, 12, 12])).toBe("15/12/12");
    expect(parseAmount("2.3")).toBe(2.3);
    expect(parseAmount("2,3")).toBe(2.3);
    expect(parseAmount(" ")).toBeUndefined();
    expect(parseAmount("-1")).toBeUndefined();
  });

  it("sums an exercise up in a line", () => {
    const blank = { equipment: "", weightKg: undefined, reps: [], durationMinutes: undefined, settings: "" };
    expect(exerciseSummary({ ...blank, equipment: "哑铃", weightKg: 2.3, reps: [15, 12, 12] })).toBe("哑铃 · 2.3 kg · 15/12/12");
    expect(exerciseSummary({ ...blank, durationMinutes: 5, settings: "阻力 8" })).toBe("5 分钟 · 阻力 8");
    expect(exerciseSummary(blank)).toBe("");
  });
});

describe("habit titles", () => {
  it("reads the icon and the name, which may be empty", () => {
    expect(splitHabitTitle("🚶🏻")).toEqual({ icon: "🚶🏻", name: "", hasEmoji: true });
    expect(splitHabitTitle("💪🏼运动")).toEqual({ icon: "💪🏼", name: "运动", hasEmoji: true });
    expect(splitHabitTitle("👨‍👩‍👧 陪娃")).toEqual({ icon: "👨‍👩‍👧", name: "陪娃", hasEmoji: true });
    expect(splitHabitTitle("冥想")).toEqual({ icon: "冥", name: "冥想", hasEmoji: false });
    expect(joinHabitTitle(" 🚶🏻 ", " 走路 ")).toBe("🚶🏻走路");
  });

  it("takes exactly one emoji as an icon", () => {
    expect(isSingleEmoji("🚶🏻")).toBe(true);
    expect(isSingleEmoji("🇨🇳")).toBe(true);
    expect(isSingleEmoji("🚶🏻💪")).toBe(false);
    expect(isSingleEmoji("走")).toBe(false);
    expect(isSingleEmoji("")).toBe(false);
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
