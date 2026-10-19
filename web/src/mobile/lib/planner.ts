import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import type { VisibleMonth } from "@/components/MemoContent/calendar/defaultVisibleMonth";
import { type CalendarItem, parseCalendarBlock } from "@/components/MemoContent/calendar/parseCalendarBlock";
import {
  type Habit,
  HabitSchema,
  ImportCheckInSchema,
  type ImportPlannerRequest,
  ImportPlannerRequestSchema,
  ImportTodoSchema,
  type ListPlannerEntriesResponse,
  PlannerNoteSchema,
  type Todo,
  Todo_Status,
} from "@/types/proto/api/v1/planner_service_pb";

/** Per-device default week start: 0 follows the instance setting, otherwise 1 = Monday … 7 = Sunday. */
export const PLANNER_WEEK_START_KEY = "planner.weekStart";
/** Check-ins and notes older than this many days are read-only (0 = no limit), as `allowMaxUpdateDays` in the calendar block. */
export const PLANNER_MAX_UPDATE_DAYS_KEY = "planner.maxUpdateDays";
export const PLANNER_MAX_UPDATE_DAYS_DEFAULT = 7;

/** The phone's today, YYYY-MM-DD. The planner's day boundary is local midnight (requirement §2.4). */
export const localToday = (now: Date = new Date()): string => dayjs(now).format("YYYY-MM-DD");

/**
 * The dates a month grid can show: the month itself plus up to six spill-over days
 * on either side, which the grid draws greyed out.
 */
export function monthRange(month: VisibleMonth): { startDate: string; endDate: string } {
  const first = dayjs(new Date(month.year, month.month, 1));
  return {
    startDate: first.subtract(7, "day").format("YYYY-MM-DD"),
    endDate: first.endOf("month").add(7, "day").format("YYYY-MM-DD"),
  };
}

/** Active, dated, and the date is before today. Only the client can tell: "today" is the phone's. */
export const isOverdue = (todo: Pick<Todo, "status" | "date">, today: string): boolean =>
  todo.status === Todo_Status.ACTIVE && todo.date !== "" && todo.date < today;

/** A todo's status as the calendar block's task marker, so the shared grid and checkbox can draw it. */
export function todoMarker(status: Todo_Status): string {
  if (status === Todo_Status.DONE) return "x";
  if (status === Todo_Status.CANCELLED) return "-";
  return " ";
}

export interface CalendarData {
  /** Habit titles by position; the index picks each habit's colour. Archived habits stay so colours never shift. */
  events: string[];
  itemsByDate: Record<string, CalendarItem[]>;
  eventsByDate: Record<string, string[]>;
  itemCounts: Record<string, number>;
}

/**
 * Turns a range of planner entries into what the calendar block's month grid draws,
 * so the planner's calendar is the same grid: check-ins become event dots, todos
 * become tasks (the square dot), notes become plain items.
 */
export function buildCalendarData(habits: Habit[], entries: ListPlannerEntriesResponse | undefined): CalendarData {
  const events = habits.map((habit) => habit.title);
  const titleOf = new Map(habits.map((habit) => [habit.name, habit.title]));
  const itemsByDate: Record<string, CalendarItem[]> = {};
  const push = (date: string, item: CalendarItem) => {
    if (!itemsByDate[date]) itemsByDate[date] = [];
    itemsByDate[date].push(item);
  };
  for (const checkIn of entries?.checkIns ?? []) {
    const title = titleOf.get(checkIn.habit);
    if (title) push(checkIn.date, { text: title, isEvent: true, comment: checkIn.note || undefined });
  }
  for (const todo of entries?.todos ?? []) {
    const marker = todoMarker(todo.status);
    push(todo.date, { text: todo.title, marker, checked: marker === "x" });
  }
  for (const note of entries?.notes ?? []) {
    push(note.date, { text: note.content });
  }

  const eventsByDate: Record<string, string[]> = {};
  const itemCounts: Record<string, number> = {};
  for (const [date, items] of Object.entries(itemsByDate)) {
    itemCounts[date] = items.length;
    const names = events.filter((name) => items.some((item) => item.isEvent && item.text === name));
    if (names.length > 0) eventsByDate[date] = names;
  }
  return { events, itemsByDate, eventsByDate, itemCounts };
}

export interface OpenTodoGroups {
  overdue: Todo[];
  today: Todo[];
  upcoming: Todo[];
  undated: Todo[];
}

/** Splits the open list by date. The server already orders it by date with undated ones last. */
export function groupOpenTodos(todos: Todo[], today: string): OpenTodoGroups {
  const groups: OpenTodoGroups = { overdue: [], today: [], upcoming: [], undated: [] };
  for (const todo of todos) {
    if (todo.date === "") groups.undated.push(todo);
    else if (todo.date < today) groups.overdue.push(todo);
    else if (todo.date === today) groups.today.push(todo);
    else groups.upcoming.push(todo);
  }
  return groups;
}

/** The todo list below the calendar leaves out what the selected day already shows above it. */
export function todosNotShown(open: Todo[], shownAbove: Todo[]): Todo[] {
  const shown = new Set(shownAbove.map((todo) => todo.name));
  return open.filter((todo) => !shown.has(todo.name));
}

/**
 * The todos shown under a selected day: that day's own, plus — on today only —
 * every overdue one. An overdue todo stays in sight until it is closed (requirement §2.4).
 */
export function todosForDay(date: string, today: string, dated: Todo[], open: Todo[]): Todo[] {
  const own = dated.filter((todo) => todo.date === date);
  if (date !== today) return own;
  const overdue = open.filter((todo) => isOverdue(todo, today));
  return [...overdue, ...own];
}

/** What the planner's calendar shows: the month on screen, the selected day and this visit's week start. */
export interface CalendarView {
  month: VisibleMonth;
  selectedDate: string;
  weekStartOverride?: number;
}

// Kept in module memory, not storage: coming back from a todo's page lands on the same day, while reopening
// the app starts from today. `savedOn` drops a view left over from an earlier day (the app kept running past
// midnight), so a new day also starts from today.
let savedCalendarView: (CalendarView & { savedOn: string }) | undefined;

export function readCalendarView(today: string): CalendarView | undefined {
  return savedCalendarView?.savedOn === today ? savedCalendarView : undefined;
}

export function saveCalendarView(view: CalendarView, today: string) {
  savedCalendarView = { ...view, savedOn: today };
}

/** Whether a past day can still be edited: the calendar block's `allowMaxUpdateDays` guard. Todos are exempt. */
export function isDateEditable(date: string, today: string, maxUpdateDays: number): boolean {
  if (maxUpdateDays <= 0) return true;
  return dayjs(today).diff(dayjs(date), "day") < maxUpdateDays;
}

export type PostponeChoice = "tomorrow" | "dayAfterTomorrow" | "nextMonday";

/**
 * The quick dates a todo can be postponed to (requirement §2.3): tomorrow, the day after and next Monday,
 * skipping its current date (postponing must move it) and repeats (on a Sunday, tomorrow is next Monday).
 */
export function postponeChoices(today: string, current: string): { choice: PostponeChoice; date: string }[] {
  const day = dayjs(today);
  const untilMonday = (8 - day.day()) % 7 || 7;
  const choices: { choice: PostponeChoice; date: string }[] = [
    { choice: "tomorrow", date: day.add(1, "day").format("YYYY-MM-DD") },
    { choice: "dayAfterTomorrow", date: day.add(2, "day").format("YYYY-MM-DD") },
    { choice: "nextMonday", date: day.add(untilMonday, "day").format("YYYY-MM-DD") },
  ];
  return choices.filter((c, i) => c.date !== current && choices.findIndex((other) => other.date === c.date) === i);
}

// Import (requirement §2.6).

export const IMPORT_CANCEL_REASON = "迁移时关闭";

export interface ImportSummary {
  habits: number;
  checkIns: number;
  activeTodos: number;
  doneTodos: number;
  cancelledTodos: number;
  notes: number;
  /** Items before the first date line: they have no day to go on. */
  skipped: number;
}

/**
 * Converts a pasted calendar block (fences included or not) into an import request.
 *
 * - `@habit` / `@habit note` → a check-in; a name outside `events:` becomes a new habit.
 * - `- text` without brackets → a note.
 * - `[ ]` → an active todo; `[x]` → done.
 * - Any other marker (`[-]`, `[>]`, `[?]`, `[!]` …) → cancelled with the migration reason,
 *   marked as closed overdue. `[!]` also marks the todo important.
 * - A habit checked in twice on one day keeps one check-in, with both notes.
 */
export function convertCalendarBlock(source: string): { request: ImportPlannerRequest; summary: ImportSummary } {
  const parsed = parseCalendarBlock(source);
  const habitTitles = [...parsed.events];
  const request = create(ImportPlannerRequestSchema, {});
  const summary: ImportSummary = { habits: 0, checkIns: 0, activeTodos: 0, doneTodos: 0, cancelledTodos: 0, notes: 0, skipped: 0 };
  const checkIns = new Map<string, { habitIndex: number; date: string; notes: string[] }>();

  for (const group of parsed.groups) {
    if (!group.date) {
      summary.skipped += group.items.length;
      continue;
    }
    for (const item of group.items) {
      if (item.isEvent) {
        if (item.hidden) continue;
        let habitIndex = habitTitles.indexOf(item.text);
        if (habitIndex === -1) {
          habitTitles.push(item.text);
          habitIndex = habitTitles.length - 1;
        }
        const key = `${group.date}/${habitIndex}`;
        const existing = checkIns.get(key) ?? { habitIndex, date: group.date, notes: [] };
        if (item.comment) existing.notes.push(item.comment);
        checkIns.set(key, existing);
        continue;
      }
      if (item.marker === undefined) {
        request.notes.push(create(PlannerNoteSchema, { date: group.date, content: item.text }));
        summary.notes++;
        continue;
      }
      const status = item.marker === " " ? Todo_Status.ACTIVE : item.marker === "x" ? Todo_Status.DONE : Todo_Status.CANCELLED;
      const cancelled = status === Todo_Status.CANCELLED;
      request.todos.push(
        create(ImportTodoSchema, {
          closedOverdue: cancelled,
          todo: {
            title: item.text,
            date: group.date,
            status,
            cancelReason: cancelled ? IMPORT_CANCEL_REASON : "",
            important: item.marker === "!",
          },
        }),
      );
      if (status === Todo_Status.ACTIVE) summary.activeTodos++;
      else if (status === Todo_Status.DONE) summary.doneTodos++;
      else summary.cancelledTodos++;
    }
  }

  request.habits = habitTitles.map((title) => create(HabitSchema, { title }));
  for (const checkIn of checkIns.values()) {
    request.checkIns.push(
      create(ImportCheckInSchema, { habitIndex: checkIn.habitIndex, date: checkIn.date, note: checkIn.notes.join(" ") }),
    );
  }
  summary.habits = request.habits.length;
  summary.checkIns = request.checkIns.length;
  return { request, summary };
}
