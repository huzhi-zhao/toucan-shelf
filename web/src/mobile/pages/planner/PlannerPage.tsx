import dayjs from "dayjs";
import { Link, List, ListItem, Navbar, Page, Segmented, SegmentedButton, Sheet, Toast } from "konsta/react";
import { BotIcon, EllipsisIcon, LinkIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarMonthGrid } from "@/components/MemoContent/calendar/CalendarMonthGrid";
import { defaultVisibleMonth, type VisibleMonth } from "@/components/MemoContent/calendar/defaultVisibleMonth";
import { useInstance } from "@/contexts/InstanceContext";
import {
  useCreatePlannerNote,
  useCreateTodo,
  useHabits,
  useHabitVersions,
  useOpenTodos,
  usePlannerEntries,
  useSetCheckIn,
  useUpdateTodo,
} from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import { CheckIn_Source, type Habit, type Todo, Todo_Status } from "@/types/proto/api/v1/planner_service_pb";
import TodoRow from "../../components/planner/TodoRow";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useGo, usePageScroll } from "../../lib/nav";
import {
  buildCalendarData,
  foldedHabitCounts,
  groupOpenTodos,
  habitColor,
  habitsOn,
  habitTodoLabel,
  isDateEditable,
  isFailed,
  localToday,
  monthRange,
  orderDayTodos,
  PLANNER_MAX_UPDATE_DAYS_DEFAULT,
  PLANNER_MAX_UPDATE_DAYS_KEY,
  readCalendarView,
  saveCalendarView,
  splitHabitTitle,
  splitPinnedHabits,
  todosForDay,
  todosNotShown,
  weeklyCheckIns,
  weeklyGoalOn,
  weeksSpan,
} from "../../lib/planner";
import { usePlannerWeekStart } from "../../lib/plannerWeekStart";
import { usePref } from "../../lib/storage";
import { checkInRoute, MOBILE_ROUTES, noteRoute, todoRoute } from "../../routes";

type AddKind = "todo" | "note";

/** The sheets a habit chip opens (requirement §2.4.2 §4): check in, choose between that and a todo, or make the todo. */
type HabitSheet = { habit: Habit; kind: "checkIn" | "choice" | "todo"; confirming?: boolean };

/** Sunday-based offset (instance setting) → the grid's 1 = Monday … 7 = Sunday. */
const weekStartFromOffset = (offset: number) => (offset === 0 ? 7 : offset);

/**
 * The planner tab (requirement §2.3–§2.4): the calendar block's month grid on top,
 * the selected day's check-ins, todos and notes under it, and every open todo at
 * the bottom. Overdue todos stay on today and at the top of the list until closed.
 */
export default function PlannerPage() {
  const scrollRef = usePageScroll<HTMLDivElement>();
  const go = useGo(COPY.planner.title);
  const today = localToday();
  const { generalSetting } = useInstance();
  const [defaultWeekStart = 0] = usePlannerWeekStart();
  const [maxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  const resolvedDefault = defaultWeekStart || weekStartFromOffset(generalSetting.weekStartDayOffset);
  // Coming back from a todo's page keeps the day, month and week start the calendar was left on.
  const [saved] = useState(() => readCalendarView(today));
  // The view toggle under the calendar overrides the default for this visit only.
  const [weekStartOverride, setWeekStartOverride] = useState<number | undefined>(saved?.weekStartOverride);
  const weekStart = weekStartOverride ?? resolvedDefault;

  const [month, setMonth] = useState<VisibleMonth>(() => saved?.month ?? defaultVisibleMonth());
  const [selectedDate, setSelectedDate] = useState(() => saved?.selectedDate ?? today);
  useEffect(() => saveCalendarView({ month, selectedDate, weekStartOverride }, today), [month, selectedDate, weekStartOverride, today]);
  const range = monthRange(month);
  const { data: habits = [] } = useHabits();
  const { data: versions = [] } = useHabitVersions();
  const { data: entries } = usePlannerEntries(range.startDate, range.endDate);
  const { data: openTodos = [] } = useOpenTodos();
  const calendar = useMemo(
    () => buildCalendarData(habits, versions, entries, monthRange(month), today),
    [habits, versions, entries, month, today],
  );

  const setCheckIn = useSetCheckIn();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const createNote = useCreatePlannerNote();
  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  const editable = isDateEditable(selectedDate, today, maxUpdateDays);
  // A check-in records what has happened: none for a day still ahead (todos and notes are fine).
  const isFuture = selectedDate > today;
  const canCheckIn = editable && !isFuture;
  const checkInsOfDay = new Map((entries?.checkIns ?? []).filter((c) => c.date === selectedDate).map((c) => [c.habit, c]));
  const todosOfDay = orderDayTodos(todosForDay(selectedDate, today, entries?.todos ?? [], openTodos), versions, today);
  // The list below the calendar skips what the selected day shows: with today selected, today's and the
  // overdue todos are already listed right above.
  // A failed habit todo leaves the list: it stays only on its own day (requirement §2.4.2 §5).
  const listedTodos = todosNotShown(
    openTodos.filter((todo) => !isFailed(todo, today)),
    todosOfDay,
  );
  const groups = groupOpenTodos(listedTodos, today);
  const notesOfDay = (entries?.notes ?? []).filter((note) => note.date === selectedDate);
  const habitsOfDay = habitsOn(versions, habits, selectedDate);
  // Pinned habits show as buttons; the rest fold behind one, opening a sheet of them (requirement §2.4.2 §2).
  // Which are pinned follows today's plan on every day (§2.4.2 §2): pinning is how the page looks, not history.
  const { pinned: pinnedOfDay, folded: foldedOfDay } = splitPinnedHabits(versions, habitsOfDay, today);
  const habitByName = new Map(habits.map((habit) => [habit.name, habit]));

  // A habit todo shows its habit's check-ins in the week of its date, and a habit not checked in yet those of
  // the selected day's week, counted from the default week start, not this visit's toggle. Those weeks can
  // reach past the month on screen, so they load on their own.
  const habitTodoDates = [...todosOfDay, ...listedTodos].filter((todo) => todo.habit !== "").map((todo) => todo.date || today);
  const weeks = weeksSpan([selectedDate, ...habitTodoDates], resolvedDefault) ?? range;
  const { data: weekEntries } = usePlannerEntries(weeks.startDate, weeks.endDate);
  const habitLabel = (todo: Todo) => {
    const habit = habitByName.get(todo.habit);
    if (!habit) return undefined;
    const date = todo.date || today;
    const done = weeklyCheckIns(weekEntries?.checkIns ?? [], todo.habit, date, resolvedDefault);
    return habitTodoLabel(habit.title, done, weeklyGoalOn(versions, todo.habit, date, resolvedDefault));
  };

  // Sheets.
  const [addKind, setAddKind] = useState<AddKind>();
  const [draft, setDraft] = useState("");
  // A habit sheet keeps what it shows while it slides away, so it does not flip to another mode as the new
  // check-in or todo lands.
  const [habitSheet, setHabitSheet] = useState<HabitSheet>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [habitSheetOpen, setHabitSheetOpen] = useState<HabitSheet["kind"]>();
  const addInputRef = useRef<HTMLTextAreaElement>(null);
  const habitTodoInputRef = useRef<HTMLInputElement>(null);
  useBlurOnClose(addKind !== undefined || habitSheetOpen !== undefined);

  const toggleTodo = (todo: Todo) => {
    // A todo that checked in its habit stays done (requirement §2.4.1).
    if (todo.checkInDate) return;
    const status = todo.status === Todo_Status.DONE ? Todo_Status.ACTIVE : Todo_Status.DONE;
    updateTodo.mutate({ name: todo.name, changes: { status }, localDate: today }, { onError: fail });
  };
  const openTodo = (todo: Todo) => go(todoRoute(todo.name));

  // The habit's todo on the selected day, whatever its status: there is at most one.
  const habitTodoOfDay = (habit: Habit) => (entries?.todos ?? []).find((todo) => todo.habit === habit.name && todo.date === selectedDate);

  // The todo a chip opens instead of a sheet: the one whose completion made the day's check-in, or the
  // habit todo of the day that is to make it (completing, backfilling, or deleting a failed one).
  const todoOfHabit = (habit: Habit) => {
    const checkIn = checkInsOfDay.get(habit.name);
    if (checkIn) return checkIn.todo || undefined;
    return habitTodoOfDay(habit)?.name;
  };

  const openHabitSheet = (sheet: HabitSheet) => {
    setHabitSheet(sheet);
    setHabitSheetOpen(sheet.kind);
  };
  const openCheckIn = (habit: Habit) => {
    setDraft(checkInsOfDay.get(habit.name)?.note ?? "");
    openHabitSheet({ habit, kind: "checkIn", confirming: !checkInsOfDay.has(habit.name) });
  };
  const openHabitTodo = (habit: Habit) => {
    setDraft(habit.title);
    openHabitSheet({ habit, kind: "todo" });
    // Focus inside the tap so iOS opens the keyboard (see openAdd).
    habitTodoInputRef.current?.focus({ preventScroll: true });
  };

  // Requirement §2.4.2 §4. A todo tied to the habit that day opens instead of any sheet. Otherwise: a check-in
  // already there edits its note or takes it back; a day ahead makes a habit todo; today offers both a check-in
  // and a todo; a past day only checks in. Checking in asks to confirm, so a stray tap records nothing.
  const tapHabit = (habit: Habit) => {
    // A check-in with a workout, or one a bot made, opens its own page: the exercises and who made it (§2.4.4).
    const checkIn = checkInsOfDay.get(habit.name);
    // One that completed a todo lives on the todo's page, plan and all.
    if (checkIn?.todo) {
      go(todoRoute(checkIn.todo));
      return;
    }
    if (checkIn && (checkIn.workout || checkIn.source === CheckIn_Source.AGENT)) {
      go(checkInRoute(habit.name, selectedDate));
      return;
    }
    const todo = todoOfHabit(habit);
    if (todo) {
      go(todoRoute(todo));
      return;
    }
    if (isFuture) openHabitTodo(habit);
    else if (selectedDate === today && !checkInsOfDay.has(habit.name)) openHabitSheet({ habit, kind: "choice" });
    else if (canCheckIn) openCheckIn(habit);
  };

  const openAdd = (kind: AddKind) => {
    setDraft("");
    setAddKind(kind);
    // Focus now, inside the tap, so iOS opens the keyboard. Not `autoFocus`: the sheet is mounted while
    // closed, so that would focus a hidden field on page load and iOS would show its keyboard on every
    // return to the app.
    addInputRef.current?.focus({ preventScroll: true });
  };

  const saveAdd = async () => {
    const lines = draft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    setAddKind(undefined);
    try {
      if (addKind === "todo") {
        for (const title of lines) await createTodo.mutateAsync({ title, date: selectedDate });
      } else if (addKind === "note" && draft.trim()) {
        await createNote.mutateAsync({ date: selectedDate, content: draft.trim() });
      }
    } catch {
      fail();
    }
  };

  const saveCheckInNote = (checked: boolean) => {
    if (!habitSheet) return;
    setCheckIn.mutate({ habit: habitSheet.habit.name, date: selectedDate, note: draft.trim(), checked }, { onError: fail });
    setHabitSheetOpen(undefined);
  };

  const saveHabitTodo = () => {
    if (!habitSheet || !draft.trim()) return;
    createTodo.mutate({ title: draft.trim(), date: selectedDate, habit: habitSheet.habit.name, localDate: today }, { onError: fail });
    setHabitSheetOpen(undefined);
  };

  const selectMonth = (next: VisibleMonth) => {
    setMonth(next);
    const prefix = `${next.year}-${String(next.month + 1).padStart(2, "0")}`;
    if (!selectedDate.startsWith(prefix)) {
      setSelectedDate(prefix === today.slice(0, 7) ? today : `${prefix}-01`);
    }
  };

  // One habit's button: filled once checked in, with its weekly progress, linked todo, agent mark and note.
  // In the day's row a button shows only the habit's icon, to keep the row on one line; the "⋯" sheet has room
  // for the whole title.
  const habitButton = (habit: Habit, iconOnly = false) => {
    const checkIn = checkInsOfDay.get(habit.name);
    const color = habitColor(habit);
    const linked = Boolean(todoOfHabit(habit));
    const byAgent = checkIn?.source === CheckIn_Source.AGENT;
    const enabled = canCheckIn || linked || isFuture || Boolean(checkIn?.workout) || byAgent;
    const goal = weeklyGoalOn(versions, habit.name, selectedDate, resolvedDefault);
    const progress =
      !checkIn && goal > 0 ? `${weeklyCheckIns(weekEntries?.checkIns ?? [], habit.name, selectedDate, resolvedDefault)}/${goal}` : "";
    return (
      <button
        key={habit.name}
        type="button"
        disabled={!enabled}
        title={iconOnly ? habit.title : undefined}
        aria-label={iconOnly ? habit.title : undefined}
        onClick={() => tapHabit(habit)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] border transition-colors",
          checkIn ? "text-white border-transparent" : "border-black/15 dark:border-white/20 bg-white dark:bg-[#1c1c1e]",
          !enabled && "opacity-60",
        )}
        style={checkIn ? { backgroundColor: color } : undefined}
      >
        <span>{iconOnly ? splitHabitTitle(habit.title).icon || habit.title : habit.title}</span>
        {progress && <span className="text-[12px] text-black/45 dark:text-white/45">{progress}</span>}
        {linked && <LinkIcon className={cn("w-3 h-3", checkIn ? "text-white/85" : "text-black/40 dark:text-white/40")} />}
        {byAgent && <BotIcon className="w-3.5 h-3.5 text-white/85" aria-label={COPY.checkIn.sources.AGENT} />}
        {/* Checked in, the button names the habit; the note can run long, so it stays on the check-in. */}
        {checkIn && iconOnly && splitHabitTitle(habit.title).hasEmoji && splitHabitTitle(habit.title).name && (
          <span className="text-white/90 text-[13px] max-w-24 truncate">{splitHabitTitle(habit.title).name}</span>
        )}
      </button>
    );
  };

  const day = dayjs(selectedDate);
  const dayTitle = `${day.format("M月D日")} ${COPY.planner.weekdays[day.day()]}${selectedDate === today ? ` · ${COPY.planner.today}` : ""}`;
  // A folded habit's check-in is out of sight behind "⋯", so the day's list shows it too; pinned ones are the buttons above.
  const dayIsEmpty = todosOfDay.length === 0 && notesOfDay.length === 0;
  const foldedCounts = foldedHabitCounts(
    foldedOfDay,
    (habit) => checkInsOfDay.has(habit),
    (habit) => weeklyGoalOn(versions, habit, selectedDate, resolvedDefault),
  );
  const listSections: { key: string; title: string; todos: Todo[]; danger?: boolean }[] = [
    { key: "overdue", title: COPY.todo.overdue, todos: groups.overdue, danger: true },
    { key: "thisWeek", title: COPY.planner.thisWeek, todos: groups.thisWeek },
    { key: "later", title: COPY.planner.later, todos: groups.later },
    { key: "undated", title: COPY.planner.undated, todos: groups.undated },
  ];

  return (
    <Page ref={scrollRef} className="pb-tabbar">
      <Navbar
        title={COPY.planner.title}
        large
        transparent
        centerTitle
        right={
          <Link iconOnly onClick={() => go(MOBILE_ROUTES.PLAN_SETTINGS)} aria-label={COPY.plannerSettings.title}>
            <Settings2Icon className="w-6 h-6" />
          </Link>
        }
      />

      <div className="mx-4 mt-3 rounded-2xl bg-white dark:bg-[#1c1c1e] p-2.5">
        <CalendarMonthGrid
          // The grid seeds its dot filter from `events` once, on mount. Habits load after the
          // first render here (in a calendar block they come with the text), so remount when
          // they change or every habit's dots would start filtered out.
          key={calendar.events.join("\n")}
          slotsOf={calendar.slotsOf}
          colorOf={calendar.colorOf}
          iconOf={calendar.iconOf}
          month={month}
          onMonthChange={selectMonth}
          itemCounts={calendar.itemCounts}
          itemsByDate={calendar.itemsByDate}
          eventsByDate={calendar.eventsByDate}
          events={calendar.events}
          showTaskDot
          weekStartDay={weekStart}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>
      <div className="flex justify-end px-4 pt-2">
        <button
          type="button"
          onClick={() => setWeekStartOverride(weekStart === 7 ? 1 : 7)}
          className="text-[13px] text-primary px-1 py-0.5"
        >
          {COPY.planner.weekStartFrom(COPY.planner.weekdays[weekStart % 7])} ⇄
        </button>
      </div>

      <SectionTitle
        className="mt-3"
        action={
          <div className="flex gap-2">
            <button type="button" className="flex items-center gap-0.5 text-[15px] text-primary" onClick={() => openAdd("todo")}>
              <PlusIcon className="w-4 h-4" />
              {COPY.planner.addTodo}
            </button>
            {editable && (
              <button type="button" className="flex items-center gap-0.5 text-[15px] text-primary" onClick={() => openAdd("note")}>
                <PlusIcon className="w-4 h-4" />
                {COPY.planner.addNote}
              </button>
            )}
          </div>
        }
      >
        {dayTitle}
      </SectionTitle>

      {habitsOfDay.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {pinnedOfDay.map((habit) => habitButton(habit, true))}
          {foldedOfDay.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px] border border-black/15 dark:border-white/20 bg-white dark:bg-[#1c1c1e]"
            >
              <EllipsisIcon className="w-4 h-4" />
              {foldedCounts.total > 0 && (
                <span className="text-[12px] text-black/45 dark:text-white/45">
                  {COPY.planner.moreHabits(foldedCounts.checked, foldedCounts.total)}
                </span>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3 text-[13px] text-black/45 dark:text-white/45">{COPY.planner.noHabits}</div>
      )}
      {!editable && <div className="px-4 pb-2 text-[12px] text-black/40 dark:text-white/40">{COPY.planner.readonlyDay(maxUpdateDays)}</div>}
      {isFuture && habitsOfDay.length > 0 && (
        <div className="px-4 pb-2 text-[12px] text-black/40 dark:text-white/40">{COPY.planner.futureCheckIn}</div>
      )}

      {dayIsEmpty ? (
        <div className="px-4 py-3 text-[14px] text-black/40 dark:text-white/40">{COPY.planner.dayEmpty}</div>
      ) : (
        <List strongIos insetIos dividersIos className="!my-0">
          {todosOfDay.map((todo) => (
            <TodoRow key={todo.name} todo={todo} today={today} habitLabel={habitLabel(todo)} onToggle={toggleTodo} onOpen={openTodo} />
          ))}
          {notesOfDay.map((note) => (
            <ListItem
              key={note.name}
              link
              chevron={false}
              title={<span className="whitespace-pre-wrap text-[15px]">{note.content}</span>}
              media={<span className="w-[22px] text-center text-[15px] leading-none">📋</span>}
              onClick={() => go(noteRoute(note.name))}
            />
          ))}
        </List>
      )}

      <SectionTitle className="mt-8">
        {COPY.planner.todoList}
        <span className="ml-2 text-[15px] font-normal text-black/40 dark:text-white/40">{listedTodos.length}</span>
      </SectionTitle>
      {listedTodos.length === 0 ? (
        <div className="px-4 py-3 text-[14px] text-black/40 dark:text-white/40">
          {openTodos.length === 0 ? COPY.planner.allClear : COPY.planner.allShownAbove}
        </div>
      ) : (
        listSections
          .filter((section) => section.todos.length > 0)
          .map((section) => (
            <div key={section.key} className="mb-4">
              <div
                className={cn("px-8 pb-1.5 text-[13px] uppercase", section.danger ? "text-red-500" : "text-black/45 dark:text-white/45")}
              >
                {section.title}
              </div>
              <List strongIos insetIos dividersIos className="!my-0">
                {section.todos.map((todo) => (
                  <TodoRow
                    key={todo.name}
                    todo={todo}
                    today={today}
                    showDate
                    habitLabel={habitLabel(todo)}
                    onToggle={toggleTodo}
                    onOpen={openTodo}
                  />
                ))}
              </List>
            </div>
          ))
      )}

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={addKind !== undefined} onBackdropClick={() => setAddKind(undefined)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          {editable && (
            <Segmented strong className="mb-3">
              <SegmentedButton active={addKind === "todo"} onClick={() => setAddKind("todo")}>
                {COPY.planner.addTodo}
              </SegmentedButton>
              <SegmentedButton active={addKind === "note"} onClick={() => setAddKind("note")}>
                {COPY.planner.addNote}
              </SegmentedButton>
            </Segmented>
          )}
          <div className="text-[13px] text-black/45 dark:text-white/45 mb-1.5">{dayTitle}</div>
          <textarea
            ref={addInputRef}
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={addKind === "note" ? COPY.planner.notePlaceholder : COPY.planner.todoPlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 p-3 text-[16px] outline-none resize-none"
          />
          <div className="flex justify-end gap-4 py-3">
            <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setAddKind(undefined)}>
              {COPY.planner.cancel}
            </button>
            <button
              type="button"
              className="text-[16px] font-semibold text-primary disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={saveAdd}
            >
              {COPY.planner.save}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet
        className="pb-safe w-full rounded-t-2xl"
        opened={habitSheetOpen === "choice"}
        onBackdropClick={() => setHabitSheetOpen(undefined)}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold">{habitSheet?.habit.title}</div>
          <div className="text-[13px] text-black/45 dark:text-white/45 mt-0.5">{dayTitle}</div>
        </div>
        <List strongIos insetIos dividersIos className="!my-3">
          <ListItem link chevron={false} title={COPY.planner.directCheckIn} onClick={() => habitSheet && openCheckIn(habitSheet.habit)} />
          <ListItem
            link
            chevron={false}
            title={COPY.planner.createHabitTodo}
            footer={COPY.planner.habitTodoHint}
            onClick={() => habitSheet && openHabitTodo(habitSheet.habit)}
          />
        </List>
      </Sheet>

      <Sheet
        className="pb-safe w-full rounded-t-2xl"
        opened={habitSheetOpen === "todo"}
        onBackdropClick={() => setHabitSheetOpen(undefined)}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold">
            {habitSheet?.habit.title} · {COPY.planner.createHabitTodo}
          </div>
          <div className="text-[13px] text-black/45 dark:text-white/45 mt-0.5 mb-2">{dayTitle}</div>
          <input
            ref={habitTodoInputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.planner.habitTodoTitle}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
          <div className="mt-2 text-[12px] text-black/40 dark:text-white/40">{COPY.planner.habitTodoHint}</div>
          <div className="flex justify-end gap-4 py-3">
            <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setHabitSheetOpen(undefined)}>
              {COPY.planner.cancel}
            </button>
            <button
              type="button"
              className="text-[16px] font-semibold text-primary disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={saveHabitTodo}
            >
              {COPY.planner.save}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet
        className="pb-safe w-full rounded-t-2xl"
        opened={habitSheetOpen === "checkIn"}
        onBackdropClick={() => setHabitSheetOpen(undefined)}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold">
            {habitSheet?.habit.title} · {habitSheet?.confirming ? COPY.planner.checkIns : COPY.planner.checkInNote}
          </div>
          <div className="flex items-baseline justify-between mt-0.5 mb-2">
            <span className="text-[13px] text-black/45 dark:text-white/45">{dayTitle}</span>
            {habitSheet && !habitSheet.confirming && (
              <button
                type="button"
                className="text-[14px] text-primary"
                onClick={() => {
                  setHabitSheetOpen(undefined);
                  go(checkInRoute(habitSheet.habit.name, selectedDate));
                }}
              >
                {COPY.checkIn.workout} ›
              </button>
            )}
          </div>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.planner.checkInNotePlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
          <div className="flex justify-between py-3">
            {habitSheet?.confirming ? (
              <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setHabitSheetOpen(undefined)}>
                {COPY.planner.cancel}
              </button>
            ) : (
              <button type="button" className="text-[16px] text-red-500" onClick={() => saveCheckInNote(false)}>
                {COPY.planner.uncheck}
              </button>
            )}
            <button type="button" className="text-[16px] font-semibold text-primary" onClick={() => saveCheckInNote(true)}>
              {habitSheet?.confirming ? COPY.planner.confirmCheckIn : COPY.planner.save}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={moreOpen} onBackdropClick={() => setMoreOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3 pb-4">
          <div className="text-[15px] font-semibold mb-3">
            {dayTitle} · {COPY.planner.foldedHabits}
          </div>
          {/* A tap closes this sheet first: the habit opens its own sheet or page, as from the row above. */}
          <div className="flex flex-wrap gap-2" onClickCapture={() => setMoreOpen(false)}>
            {foldedOfDay.map((habit) => habitButton(habit))}
          </div>
        </div>
      </Sheet>

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
