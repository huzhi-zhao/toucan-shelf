import dayjs from "dayjs";
import { Link, List, ListItem, Navbar, Page, Segmented, SegmentedButton, Sheet, Toast } from "konsta/react";
import { PlusIcon, Settings2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarMonthGrid } from "@/components/MemoContent/calendar/CalendarMonthGrid";
import { defaultVisibleMonth, type VisibleMonth } from "@/components/MemoContent/calendar/defaultVisibleMonth";
import { getEventColorByName } from "@/components/MemoContent/calendar/eventColors";
import { useInstance } from "@/contexts/InstanceContext";
import {
  useCreatePlannerNote,
  useCreateTodo,
  useDeletePlannerNote,
  useHabits,
  useOpenTodos,
  usePlannerEntries,
  useSetCheckIn,
  useUpdatePlannerNote,
  useUpdateTodo,
} from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import { type Habit, type PlannerNote, type Todo, Todo_Status } from "@/types/proto/api/v1/planner_service_pb";
import TodoRow from "../../components/planner/TodoRow";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useGo, usePageScroll } from "../../lib/nav";
import {
  buildCalendarData,
  groupOpenTodos,
  isDateEditable,
  localToday,
  monthRange,
  PLANNER_MAX_UPDATE_DAYS_DEFAULT,
  PLANNER_MAX_UPDATE_DAYS_KEY,
  PLANNER_WEEK_START_KEY,
  readCalendarView,
  saveCalendarView,
  todosForDay,
  todosNotShown,
} from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { MOBILE_ROUTES, todoRoute } from "../../routes";

type AddKind = "todo" | "note";

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
  const [defaultWeekStart] = usePref(PLANNER_WEEK_START_KEY, 0);
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
  const { data: entries } = usePlannerEntries(range.startDate, range.endDate);
  const { data: openTodos = [] } = useOpenTodos();
  const calendar = useMemo(() => buildCalendarData(habits, entries), [habits, entries]);

  const setCheckIn = useSetCheckIn();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const createNote = useCreatePlannerNote();
  const updateNote = useUpdatePlannerNote();
  const deleteNote = useDeletePlannerNote();
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
  const todosOfDay = todosForDay(selectedDate, today, entries?.todos ?? [], openTodos);
  // The list below the calendar skips what the selected day shows: with today selected, today's and the
  // overdue todos are already listed right above.
  const listedTodos = todosNotShown(openTodos, todosOfDay);
  const groups = groupOpenTodos(listedTodos, today);
  const notesOfDay = (entries?.notes ?? []).filter((note) => note.date === selectedDate);
  const activeHabits = habits.filter((habit) => !habit.archived);

  // Sheets.
  const [addKind, setAddKind] = useState<AddKind>();
  const [draft, setDraft] = useState("");
  // The check-in sheet keeps what it shows while it slides away, so it does not flip to the other mode
  // as the new check-in lands.
  const [checkInSheet, setCheckInSheet] = useState<{ habit: Habit; confirming: boolean }>();
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<PlannerNote>();
  const addInputRef = useRef<HTMLTextAreaElement>(null);
  useBlurOnClose(addKind !== undefined || checkInOpen || noteTarget !== undefined);

  const toggleTodo = (todo: Todo) => {
    const status = todo.status === Todo_Status.DONE ? Todo_Status.ACTIVE : Todo_Status.DONE;
    updateTodo.mutate({ name: todo.name, changes: { status }, localDate: today }, { onError: fail });
  };
  const openTodo = (todo: Todo) => go(todoRoute(todo.name));

  // Tapping a habit opens its sheet either way: one not checked in yet asks to confirm (a stray tap in the
  // chip row must not record a check-in), with room for a note; one already checked in edits the note or
  // takes the check-in back.
  const tapHabit = (habit: Habit) => {
    if (!canCheckIn) return;
    setDraft(checkInsOfDay.get(habit.name)?.note ?? "");
    setCheckInSheet({ habit, confirming: !checkInsOfDay.has(habit.name) });
    setCheckInOpen(true);
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
    if (!checkInSheet) return;
    setCheckIn.mutate({ habit: checkInSheet.habit.name, date: selectedDate, note: draft.trim(), checked }, { onError: fail });
    setCheckInOpen(false);
  };

  const saveNote = (remove: boolean) => {
    if (!noteTarget) return;
    if (remove) deleteNote.mutate(noteTarget.name, { onError: fail });
    else if (draft.trim()) updateNote.mutate({ name: noteTarget.name, content: draft.trim() }, { onError: fail });
    setNoteTarget(undefined);
  };

  const selectMonth = (next: VisibleMonth) => {
    setMonth(next);
    const prefix = `${next.year}-${String(next.month + 1).padStart(2, "0")}`;
    if (!selectedDate.startsWith(prefix)) {
      setSelectedDate(prefix === today.slice(0, 7) ? today : `${prefix}-01`);
    }
  };

  const day = dayjs(selectedDate);
  const dayTitle = `${day.format("M月D日")} ${COPY.planner.weekdays[day.day()]}${selectedDate === today ? ` · ${COPY.planner.today}` : ""}`;
  const dayIsEmpty = checkInsOfDay.size === 0 && todosOfDay.length === 0 && notesOfDay.length === 0;
  const listSections: { key: string; title: string; todos: Todo[]; danger?: boolean }[] = [
    { key: "overdue", title: COPY.todo.overdue, todos: groups.overdue, danger: true },
    { key: "today", title: COPY.planner.today, todos: groups.today },
    { key: "upcoming", title: COPY.planner.upcoming, todos: groups.upcoming },
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

      {activeHabits.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {activeHabits.map((habit) => {
            const checkIn = checkInsOfDay.get(habit.name);
            const color = getEventColorByName(habit.title, calendar.events);
            return (
              <button
                key={habit.name}
                type="button"
                disabled={!canCheckIn}
                onClick={() => tapHabit(habit)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] border transition-colors",
                  checkIn ? "text-white border-transparent" : "border-black/15 dark:border-white/20 bg-white dark:bg-[#1c1c1e]",
                  !canCheckIn && "opacity-60",
                )}
                style={checkIn ? { backgroundColor: color } : undefined}
              >
                {!checkIn && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />}
                <span>{habit.title}</span>
                {checkIn?.note && <span className="text-white/85 text-[12px] max-w-24 truncate">{checkIn.note}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-4 pb-3 text-[13px] text-black/45 dark:text-white/45">{COPY.planner.noHabits}</div>
      )}
      {!editable && <div className="px-4 pb-2 text-[12px] text-black/40 dark:text-white/40">{COPY.planner.readonlyDay(maxUpdateDays)}</div>}
      {isFuture && <div className="px-4 pb-2 text-[12px] text-black/40 dark:text-white/40">{COPY.planner.futureCheckIn}</div>}

      {dayIsEmpty ? (
        <div className="px-4 py-3 text-[14px] text-black/40 dark:text-white/40">{COPY.planner.dayEmpty}</div>
      ) : (
        <List strongIos insetIos dividersIos className="!my-0">
          {todosOfDay.map((todo) => (
            <TodoRow key={todo.name} todo={todo} today={today} onToggle={toggleTodo} onOpen={openTodo} />
          ))}
          {notesOfDay.map((note) => (
            <ListItem
              key={note.name}
              link={editable}
              chevron={false}
              title={<span className="whitespace-pre-wrap text-[15px]">{note.content}</span>}
              media={<span className="w-[22px] text-center text-black/35 dark:text-white/35">·</span>}
              onClick={() => {
                if (!editable) return;
                setDraft(note.content);
                setNoteTarget(note);
              }}
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
                  <TodoRow key={todo.name} todo={todo} today={today} showDate onToggle={toggleTodo} onOpen={openTodo} />
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

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={checkInOpen} onBackdropClick={() => setCheckInOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold">
            {checkInSheet?.habit.title} · {checkInSheet?.confirming ? COPY.planner.checkIns : COPY.planner.checkInNote}
          </div>
          <div className="text-[13px] text-black/45 dark:text-white/45 mt-0.5 mb-2">{dayTitle}</div>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.planner.checkInNotePlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
          <div className="flex justify-between py-3">
            {checkInSheet?.confirming ? (
              <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setCheckInOpen(false)}>
                {COPY.planner.cancel}
              </button>
            ) : (
              <button type="button" className="text-[16px] text-red-500" onClick={() => saveCheckInNote(false)}>
                {COPY.planner.uncheck}
              </button>
            )}
            <button type="button" className="text-[16px] font-semibold text-primary" onClick={() => saveCheckInNote(true)}>
              {checkInSheet?.confirming ? COPY.planner.confirmCheckIn : COPY.planner.save}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={noteTarget !== undefined} onBackdropClick={() => setNoteTarget(undefined)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold mb-2">{COPY.planner.editNote}</div>
          <textarea
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 p-3 text-[16px] outline-none resize-none"
          />
          <div className="flex justify-between py-3">
            <button type="button" className="text-[16px] text-red-500" onClick={() => saveNote(true)}>
              {COPY.planner.delete}
            </button>
            <button
              type="button"
              className="text-[16px] font-semibold text-primary disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={() => saveNote(false)}
            >
              {COPY.planner.save}
            </button>
          </div>
        </div>
      </Sheet>

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
