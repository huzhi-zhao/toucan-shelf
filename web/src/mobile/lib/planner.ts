import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import type { VisibleMonth } from "@/components/MemoContent/calendar/defaultVisibleMonth";
import { EVENT_COLORS } from "@/components/MemoContent/calendar/eventColors";
import { type CalendarItem, parseCalendarBlock } from "@/components/MemoContent/calendar/parseCalendarBlock";
import {
  type CheckIn,
  type Habit,
  HabitSchema,
  type HabitVersion,
  ImportCheckInSchema,
  type ImportPlannerRequest,
  ImportPlannerRequestSchema,
  ImportTodoSchema,
  type ListPlannerEntriesResponse,
  PlannerNoteSchema,
  type Todo,
  Todo_Status,
} from "@/types/proto/api/v1/planner_service_pb";

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

/**
 * Active, dated, and the date is before today. Only the client can tell: "today" is the phone's. A habit todo
 * is never overdue: past its day it has failed instead (see isFailed).
 */
export const isOverdue = (todo: Pick<Todo, "status" | "date" | "habit">, today: string): boolean =>
  todo.habit === "" && todo.status === Todo_Status.ACTIVE && todo.date !== "" && todo.date < today;

/**
 * A habit todo whose day has passed without it being done (requirement §2.4.2 §5). Worked out from the date,
 * not stored: it leaves the open list, stays on its own day, and can only be backfilled or deleted.
 */
export const isFailed = (todo: Pick<Todo, "status" | "date" | "habit">, today: string): boolean =>
  todo.habit !== "" && todo.status === Todo_Status.ACTIVE && todo.date !== "" && todo.date < today;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * A habit's icon and name, both read from its title (requirement §2.4.2 §1): a title starts with an emoji,
 * its icon, and the rest, maybe nothing, is its name ("🚶🏻", "💪运动"). A title not starting with an emoji
 * (older habits) keeps the whole title as its name and lends its first character as the icon.
 */
export function splitHabitTitle(title: string): { icon: string; name: string; hasEmoji: boolean } {
  const trimmed = title.trim();
  const first = graphemes.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "";
  if (!EMOJI.test(first)) return { icon: first, name: trimmed, hasEmoji: false };
  return { icon: first, name: trimmed.slice(first.length).trim(), hasEmoji: true };
}

/** The title a habit is saved under: its icon, then its name if any. */
export const joinHabitTitle = (icon: string, name: string): string => `${icon.trim()}${name.trim()}`;

/** Whether a typed icon is exactly one emoji. */
export function isSingleEmoji(icon: string): boolean {
  const parts = [...graphemes.segment(icon.trim())];
  return parts.length === 1 && EMOJI.test(parts[0].segment);
}

/** A habit's dot and chip color: its own palette index, the same on every day. */
export const habitColor = (habit: Pick<Habit, "color">): string => EVENT_COLORS[habit.color % EVENT_COLORS.length];

/** The version in use on a date: the latest one effective on or before it. `versions` are earliest first. */
export function habitVersionOn(versions: HabitVersion[], date: string): HabitVersion | undefined {
  let on: HabitVersion | undefined;
  for (const version of versions) {
    if (version.effectiveDate > date) break;
    on = version;
  }
  return on;
}

/** The habits of the version in use on a date, in its order. */
export function habitsOn(versions: HabitVersion[], habits: Habit[], date: string): Habit[] {
  const byName = new Map(habits.map((habit) => [habit.name, habit]));
  return (habitVersionOn(versions, date)?.entries ?? []).flatMap((entry) => byName.get(entry.habit) ?? []);
}

/** The habits of the plan in use on a day that are pinned (at most three): the planner page shows them, the rest fold away. */
/** How many habits a plan pins to the planner page. */
export const MAX_PINNED_HABITS = 3;

/**
 * Splits a day's habits into the pinned ones and the folded rest. Pinning is a display preference, not history
 * (requirement §2.4.2 §2): every day follows the pins of the plan in use today, in that plan's order, so pinning
 * a habit shows it on past days too. A habit of the day that today's plan does not pin is folded.
 */
export function splitPinnedHabits(versions: HabitVersion[], dayHabits: Habit[], today: string): { pinned: Habit[]; folded: Habit[] } {
  const byName = new Map(dayHabits.map((habit) => [habit.name, habit]));
  const pinned = (habitVersionOn(versions, today)?.entries ?? [])
    .filter((entry) => entry.pinned)
    .flatMap((entry) => byName.get(entry.habit) ?? [])
    .slice(0, MAX_PINNED_HABITS);
  const pinnedNames = new Set(pinned.map((habit) => habit.name));
  return { pinned, folded: dayHabits.filter((habit) => !pinnedNames.has(habit.name)) };
}

/** A version's name in lists: "最早" for the first, else "10/20 起" (with the year when it is not this one). */
export function versionLabel(effectiveDate: string, today: string, fromBeginning: string, from: (date: string) => string): string {
  if (!effectiveDate) return fromBeginning;
  return from(dayjs(effectiveDate).format(effectiveDate.slice(0, 4) === today.slice(0, 4) ? "M/D" : "YYYY/M/D"));
}

/**
 * The weekly goal a habit has in the week of `date`, 0 for none. A whole week is measured against one plan, the one
 * in effect on its last day, so a plan enabled mid-week sets the goal for every day of it (requirement §2.4.2 §3).
 */
export function weeklyGoalOn(versions: HabitVersion[], habit: string, date: string, weekStart: number): number {
  const { endDate } = weekRange(date, weekStart);
  return habitVersionOn(versions, endDate)?.entries.find((entry) => entry.habit === habit)?.weeklyGoal ?? 0;
}

/** The week a date falls in, `weekStart` being the grid's 1 = Monday … 7 = Sunday. */
export function weekRange(date: string, weekStart: number): { startDate: string; endDate: string } {
  const day = dayjs(date);
  const start = day.subtract((day.day() - (weekStart % 7) + 7) % 7, "day");
  return { startDate: start.format("YYYY-MM-DD"), endDate: start.add(6, "day").format("YYYY-MM-DD") };
}

/** How often a habit was checked in during the week of `date`: directly or by a todo, all count. */
export function weeklyCheckIns(checkIns: CheckIn[], habit: string, date: string, weekStart: number): number {
  const { startDate, endDate } = weekRange(date, weekStart);
  return checkIns.filter((checkIn) => checkIn.habit === habit && checkIn.date >= startDate && checkIn.date <= endDate).length;
}

/** The habit shown after a habit todo's title: "🚶 2/3", or just "🚶" when its version sets no goal. */
export function habitTodoLabel(title: string, done: number, goal: number): string {
  return goal > 0 ? `${title} ${done}/${goal}` : title;
}

/** The dates spanned by the weeks of the given dates, for loading the check-ins their progress needs. */
export function weeksSpan(dates: string[], weekStart: number): { startDate: string; endDate: string } | undefined {
  const sorted = dates.filter(Boolean).sort();
  if (sorted.length === 0) return undefined;
  return { startDate: weekRange(sorted[0], weekStart).startDate, endDate: weekRange(sorted[sorted.length - 1], weekStart).endDate };
}

/** A todo's status as the calendar block's task marker, so the shared grid and checkbox can draw it. */
export function todoMarker(status: Todo_Status): string {
  if (status === Todo_Status.DONE) return "x";
  if (status === Todo_Status.CANCELLED) return "-";
  return " ";
}

export interface CalendarData {
  /** Titles of the habits in use at some point of the range, for the dot filter. */
  events: string[];
  /** A day's dot slots: the titles of its version's habits, in order. */
  slotsOf: (date: string) => string[];
  /** A habit's dot color, by title. */
  colorOf: (title: string) => string;
  /** A habit's icon, by title. */
  iconOf: (title: string) => string;
  itemsByDate: Record<string, CalendarItem[]>;
  eventsByDate: Record<string, string[]>;
  itemCounts: Record<string, number>;
}

/**
 * Turns a range of planner entries into what the calendar block's month grid draws,
 * so the planner's calendar is the same grid: check-ins become event dots, todos
 * become tasks (the square dot), notes become plain items. Each day's dots follow the
 * habit version in use that day (requirement §2.4.2 §2).
 */
export function buildCalendarData(
  habits: Habit[],
  versions: HabitVersion[],
  entries: ListPlannerEntriesResponse | undefined,
  range: { startDate: string; endDate: string },
): CalendarData {
  const titleOf = new Map(habits.map((habit) => [habit.name, habit.title]));
  const colorByTitle = new Map(habits.map((habit) => [habit.title, habitColor(habit)]));
  const events: string[] = [];
  versions.forEach((version, i) => {
    const next = versions[i + 1];
    if (version.effectiveDate > range.endDate || (next && next.effectiveDate <= range.startDate)) return;
    for (const entry of version.entries) {
      const title = titleOf.get(entry.habit);
      if (title && !events.includes(title)) events.push(title);
    }
  });
  // Every habit of the day has a place in its cell, in the order its plan lists them (set when making the plan),
  // so a folded habit's check-in shows too. The cell keeps one row of icons and folds what does not fit into "+N".
  const slotsOf = (date: string) => habitsOn(versions, habits, date).map((habit) => habit.title);
  const colorOf = (title: string) => colorByTitle.get(title) ?? "#9ca3af";
  const iconOf = (title: string) => splitHabitTitle(title).icon;
  const itemsByDate: Record<string, CalendarItem[]> = {};
  const push = (date: string, item: CalendarItem) => {
    if (!itemsByDate[date]) itemsByDate[date] = [];
    itemsByDate[date].push(item);
  };
  for (const checkIn of entries?.checkIns ?? []) {
    const title = titleOf.get(checkIn.habit);
    if (title) push(checkIn.date, { text: title, isEvent: true, comment: checkIn.note || undefined });
  }
  // 习惯待办不进格子：做完就是一次打卡，已经画成图标了。待办排在备忘前面，格子里预览两行时先给待办。
  for (const todo of entries?.todos ?? []) {
    if (todo.habit) continue;
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
    const names = slotsOf(date).filter((name) => items.some((item) => item.isEvent && item.text === name));
    if (names.length > 0) eventsByDate[date] = names;
  }
  return { events, slotsOf, colorOf, iconOf, itemsByDate, eventsByDate, itemCounts };
}

export interface OpenTodoGroups {
  overdue: Todo[];
  /** Today and the six days after it. */
  thisWeek: Todo[];
  later: Todo[];
  undated: Todo[];
}

/** How many days, today included, the "this week" group of the todo list covers. */
export const THIS_WEEK_DAYS = 7;

/** Splits the open list by date. The server already orders it by date with undated ones last. */
export function groupOpenTodos(todos: Todo[], today: string): OpenTodoGroups {
  const groups: OpenTodoGroups = { overdue: [], thisWeek: [], later: [], undated: [] };
  const weekEnd = dayjs(today).add(THIS_WEEK_DAYS, "day").format("YYYY-MM-DD");
  for (const todo of todos) {
    if (todo.date === "") groups.undated.push(todo);
    else if (todo.date < today) groups.overdue.push(todo);
    else if (todo.date < weekEnd) groups.thisWeek.push(todo);
    else groups.later.push(todo);
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

/**
 * The selected day's todos in the order the list shows them: habit todos first, in today's plan's habit order
 * (as the buttons above), the open ones before the closed or failed ones; then the other todos as given.
 */
export function orderDayTodos(todos: Todo[], versions: HabitVersion[], today: string): Todo[] {
  const position = new Map((habitVersionOn(versions, today)?.entries ?? []).map((entry, i) => [entry.habit, i]));
  const settled = (todo: Todo) => (todo.status !== Todo_Status.ACTIVE || isFailed(todo, today) ? 1 : 0);
  const rank = (todo: Todo) => position.get(todo.habit) ?? position.size;
  const habitTodos = todos.filter((todo) => todo.habit !== "");
  // Array.prototype.sort is stable, so equal ones keep the order they came in.
  habitTodos.sort((a, b) => settled(a) - settled(b) || rank(a) - rank(b));
  return [...habitTodos, ...todos.filter((todo) => todo.habit === "")];
}

/**
 * What the "⋯" button counts: the folded habits that have a weekly goal, and how many of them are checked in that
 * day. A habit without a goal is kept but not counted.
 */
export function foldedHabitCounts(
  folded: Habit[],
  checkedIn: (habit: string) => boolean,
  goalOf: (habit: string) => number,
): { checked: number; total: number } {
  const counted = folded.filter((habit) => goalOf(habit.name) > 0);
  return { checked: counted.filter((habit) => checkedIn(habit.name)).length, total: counted.length };
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

export type PostponeChoice = "today" | "tomorrow" | "dayAfterTomorrow" | "nextMonday";

/**
 * The quick dates a todo can be postponed to (requirement §2.3): today for one already past its date, then
 * tomorrow, the day after and next Monday, skipping its current date (postponing must move it) and repeats (on a Sunday, tomorrow is next Monday).
 */
export function postponeChoices(today: string, current: string): { choice: PostponeChoice; date: string }[] {
  const day = dayjs(today);
  const untilMonday = (8 - day.day()) % 7 || 7;
  const choices: { choice: PostponeChoice; date: string }[] = [
    ...(current < today ? [{ choice: "today" as const, date: today }] : []),
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

/** Repetitions of each set as typed, "15/12/12" (or with spaces or commas); blanks and non-numbers dropped. */
export function parseReps(text: string): number[] {
  return text
    .split(/[\s/,，、]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
}

export const formatReps = (reps: number[]): string => reps.join("/");

/** A number typed in a field, or undefined when blank or not a non-negative number. */
export function parseAmount(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
