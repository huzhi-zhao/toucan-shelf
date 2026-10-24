import dayjs from "dayjs";
import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Sheet, Toast, Toggle } from "konsta/react";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useDeleteTodo,
  useHabits,
  usePlannerEntries,
  usePostponeTodo,
  useTodo,
  useTodoTags,
  useUpdateTodo,
} from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import { type Todo, Todo_Source, Todo_Status } from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import DocPickerSheet from "../../components/DocPickerSheet";
import { LinkedDocsList } from "../../components/LinkedDocs";
import CheckInDetail from "../../components/planner/CheckInDetail";
import TodoNoteField from "../../components/planner/TodoNoteField";
import WorkoutEditor from "../../components/planner/WorkoutEditor";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import {
  isDateEditable,
  isFailed,
  isOverdue,
  localToday,
  PLANNER_MAX_UPDATE_DAYS_DEFAULT,
  PLANNER_MAX_UPDATE_DAYS_KEY,
  postponeChoices,
} from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { docRoute, MOBILE_ROUTES, todoNameFromUid } from "../../routes";

const EDITABLE_FIELDS = ["title", "note", "url"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const isWebLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/**
 * One todo (requirement §2.2): title, day, importance, tag, note, linked documents
 * and an external link. Text fields save when they lose focus; the rest at once.
 * Closing happens here too — cancelling asks for the reason first — and so does postponing,
 * which moves the date but keeps the original one and counts (requirement §2.3).
 * A habit todo (requirement §2.4.2 §5) is for its own day: it is completed that day, checking in its habit,
 * or backfilled within the "N days" limit; past it, it has failed and can only be deleted. It is not
 * postponed and its date and habit do not change. Once it has checked in, it can only be deleted.
 */
export default function TodoPage() {
  const { uid = "" } = useParams();
  const name = todoNameFromUid(uid);
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.todo.title);
  const today = localToday();
  const { data: todo, isPending, isError } = useTodo(name);
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const [toast, setToast] = useState("");
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2000);
  };

  // Local drafts of the text fields. Every save refetches the todo, so only a field whose stored value
  // changed is reset; resetting all of them would wipe what is being typed in another field meanwhile.
  const [drafts, setDrafts] = useState<Record<EditableField, string>>({ title: "", note: "", url: "" });
  const synced = useRef<Todo | undefined>(undefined);
  useEffect(() => {
    if (!todo) return;
    const previous = synced.current;
    synced.current = todo;
    const changed = EDITABLE_FIELDS.filter((field) => !previous || previous[field] !== todo[field]);
    if (changed.length > 0) setDrafts((d) => ({ ...d, ...Object.fromEntries(changed.map((field) => [field, todo[field]])) }));
  }, [todo]);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const { data: usedTags = [] } = useTodoTags();
  const [postponeOpen, setPostponeOpen] = useState(false);
  const postponeTodo = usePostponeTodo();
  const { data: habits = [] } = useHabits();
  // A done habit todo's check-in, shown here in the plan's place.
  const checkInDate = todo?.habit ? todo.checkInDate : "";
  const { data: checkInEntries } = usePlannerEntries(checkInDate, checkInDate, checkInDate !== "");
  const checkIn = checkInEntries?.checkIns.find((c) => c.habit === todo?.habit && c.date === checkInDate);
  const [maxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  useBlurOnClose(cancelOpen || postponeOpen || pickerOpen || tagOpen);

  const postpone = (date: string) => {
    setPostponeOpen(false);
    if (!todo || !date || date === todo.date || date < today) return;
    postponeTodo.mutate({ name, date, localDate: today }, { onError: () => flash(COPY.planner.failed) });
  };

  const save = (
    changes: Partial<
      Pick<Todo, "title" | "date" | "status" | "cancelReason" | "important" | "tag" | "note" | "memos" | "url" | "plannedWorkout">
    >,
  ) => updateTodo.mutate({ name, changes, localDate: today }, { onError: () => flash(COPY.planner.failed) });

  const commitText = (field: EditableField) => {
    if (!todo) return;
    const value = drafts[field].trim();
    if (value === todo[field]) return;
    if (field === "title" && !value) {
      setDrafts((d) => ({ ...d, title: todo.title }));
      return;
    }
    if (field === "url" && value && !isWebLink(value)) {
      flash(COPY.todo.urlInvalid);
      return;
    }
    save({ [field]: value });
  };

  const confirmCancel = () => {
    if (!reason.trim()) return;
    save({ status: Todo_Status.CANCELLED, cancelReason: reason.trim() });
    setCancelOpen(false);
  };

  const remove = () => {
    if (!window.confirm(todo?.checkInDate ? COPY.todo.deleteCheckedInConfirm : COPY.todo.deleteConfirm)) return;
    deleteTodo.mutate(name, { onSuccess: back, onError: () => flash(COPY.planner.failed) });
  };

  const header = <Navbar title={COPY.todo.title} left={<NavbarBackLink text={backText} showText onClick={back} />} />;
  if (isPending) {
    return (
      <Page>
        {header}
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      </Page>
    );
  }
  if (isError || !todo) {
    return (
      <Page>
        {header}
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.todo.notFound}</div>
      </Page>
    );
  }

  const overdue = isOverdue(todo, today);
  const closed = todo.status !== Todo_Status.ACTIVE;
  // Completing it checked in its habit: it stays done, and only deleting it undoes that.
  const settled = todo.checkInDate !== "";
  const linkedHabit = habits.find((habit) => habit.name === todo.habit);
  const isHabitTodo = todo.habit !== "";
  const failed = isFailed(todo, today);
  // A failed habit todo can still be done late, by a backfill, within the days check-ins stay editable.
  const canBackfill = failed && isDateEditable(todo.date, today, maxUpdateDays);
  const notYet = isHabitTodo && todo.date > today;
  const closedOn = todo.closeTime ? dayjs(Number(todo.closeTime.seconds) * 1000).format("YYYY-MM-DD") : "";
  const statusLabel =
    todo.status === Todo_Status.DONE
      ? COPY.todo.done
      : todo.status === Todo_Status.CANCELLED
        ? COPY.todo.cancelled
        : failed
          ? COPY.todo.failed
          : overdue
            ? COPY.todo.overdue
            : COPY.todo.active;
  const inputClass = "w-full bg-transparent outline-none text-[17px] py-0.5";

  return (
    <Page className="pb-safe">
      {header}

      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        <ListItem
          title={
            <input
              value={drafts.title}
              onChange={(event) => setDrafts((d) => ({ ...d, title: event.target.value }))}
              onBlur={() => commitText("title")}
              aria-label={COPY.todo.name}
              className={cn(inputClass, "font-semibold", todo.status === Todo_Status.CANCELLED && "line-through")}
            />
          }
        />
        <ListItem
          title={COPY.todo.date}
          after={
            isHabitTodo ? (
              <span>{todo.date ? `${dayjs(todo.date).format("M/D")} ${COPY.planner.weekdays[dayjs(todo.date).day()]}` : ""}</span>
            ) : (
              <input
                type="date"
                value={todo.date}
                onChange={(event) => save({ date: event.target.value })}
                className={cn("bg-transparent text-right outline-none", overdue && "text-red-500")}
              />
            )
          }
        />
        <ListItem
          title={COPY.todo.important}
          after={<Toggle checked={todo.important} onChange={() => save({ important: !todo.important })} />}
        />
        <ListItem
          link
          title={COPY.todo.tag}
          after={todo.tag || <span className="text-black/30 dark:text-white/30">{COPY.todo.noTag}</span>}
          onClick={() => {
            setTagOpen(true);
            // With nothing to pick from, go straight to typing (focus inside the tap so iOS shows the keyboard).
            if (usedTags.length === 0) tagInputRef.current?.focus({ preventScroll: true });
          }}
        />
        {linkedHabit && (
          <ListItem
            title={COPY.todo.habit}
            after={
              <span>
                🔗 {linkedHabit.title}
                {settled && <span className="ml-1.5 text-[13px]">· {COPY.todo.checkedIn(dayjs(todo.checkInDate).format("M/D"))}</span>}
              </span>
            }
          />
        )}
      </List>

      <SectionTitle>{COPY.todo.note}</SectionTitle>
      <div className="mx-4 rounded-xl bg-white dark:bg-[#1c1c1e] p-3">
        <TodoNoteField value={drafts.note} onChange={(note) => setDrafts((d) => ({ ...d, note }))} onCommit={() => commitText("note")} />
      </div>

      {isHabitTodo && settled && checkIn && (
        // Checked in: the check-in takes the plan's place, with the plan folded under what was done.
        <CheckInDetail
          checkIn={checkIn}
          todo={todo}
          onOpenDoc={(memo) => go(docRoute(memo))}
          onRemoved={() => {}}
          onFail={() => flash(COPY.planner.failed)}
        />
      )}

      {isHabitTodo && !settled && (
        <>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              {COPY.todo.plannedWorkout}
              {todo.plannedWorkoutSource === Todo_Source.AGENT && <BotIcon className="w-4 h-4" aria-label={COPY.checkIn.sources.AGENT} />}
            </span>
          </SectionTitle>
          {/* What to do that day, against the check-in's record of what was done. History once the todo is closed or failed. */}
          <WorkoutEditor
            workout={todo.plannedWorkout}
            habit={todo.habit}
            planned
            readOnly={closed || failed}
            onChange={(plannedWorkout) => save({ plannedWorkout })}
            emptyText={COPY.todo.noPlannedWorkout}
            onOpenDoc={(memo) => go(docRoute(memo))}
          />
        </>
      )}

      <SectionTitle>{COPY.todo.doc}</SectionTitle>
      <LinkedDocsList
        memos={todo.memos}
        onOpen={(memo) => go(docRoute(memo))}
        onRemove={(memo) => save({ memos: todo.memos.filter((m) => m !== memo) })}
        onAdd={() => setPickerOpen(true)}
      />

      <SectionTitle>{COPY.todo.url}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        <ListItem
          title={
            <input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={drafts.url}
              onChange={(event) => setDrafts((d) => ({ ...d, url: event.target.value }))}
              onBlur={() => commitText("url")}
              className={inputClass}
            />
          }
        />
        {todo.url && (
          <ListItem
            link
            chevron={false}
            href={todo.url}
            target="_blank"
            title={COPY.todo.openUrl}
            after={<ExternalLinkIcon className="w-4 h-4" />}
          />
        )}
      </List>

      <SectionTitle>
        {statusLabel}
        {closed && todo.closedOverdue && <span className="ml-2 text-[13px] font-normal text-red-500">{COPY.todo.closedOverdue}</span>}
      </SectionTitle>
      {todo.status === Todo_Status.CANCELLED && todo.cancelReason && (
        <div className="mx-4 mb-2 text-[15px] text-black/60 dark:text-white/60">
          {COPY.todo.cancelReason}：{todo.cancelReason}
        </div>
      )}
      {closedOn && <div className="mx-4 mb-2 text-[13px] text-black/40 dark:text-white/40">{closedOn}</div>}
      {todo.postponeCount > 0 && (
        <div className="mx-4 mb-2 text-[13px] text-black/50 dark:text-white/50">
          {COPY.todo.postponed(dayjs(todo.originalDate).format("M/D"), todo.postponeCount)}
        </div>
      )}
      {settled && <div className="mx-4 mb-2 text-[13px] text-black/50 dark:text-white/50">{COPY.todo.settled}</div>}
      {failed && <div className="mx-4 mb-2 text-[13px] text-black/50 dark:text-white/50">{COPY.todo.failedHint(canBackfill)}</div>}
      {notYet && !closed && <div className="mx-4 mb-2 text-[13px] text-black/50 dark:text-white/50">{COPY.todo.notYet}</div>}
      <List strongIos insetIos dividersIos className="!my-0">
        {settled ? null : closed ? (
          <ListButton onClick={() => save({ status: Todo_Status.ACTIVE })}>{COPY.todo.reopen}</ListButton>
        ) : failed ? (
          canBackfill && <ListButton onClick={() => save({ status: Todo_Status.DONE })}>{COPY.todo.backfill}</ListButton>
        ) : (
          <>
            {!notYet && (
              <ListButton onClick={() => save({ status: Todo_Status.DONE })}>
                {isHabitTodo && linkedHabit ? COPY.todo.completeAndCheckIn : COPY.todo.complete}
              </ListButton>
            )}
            {todo.date && !isHabitTodo && <ListButton onClick={() => setPostponeOpen(true)}>{COPY.todo.postpone}</ListButton>}
            <DangerListButton
              onClick={() => {
                setReason("");
                setCancelOpen(true);
              }}
            >
              {COPY.todo.cancelTodo}
            </DangerListButton>
          </>
        )}
      </List>

      <List strongIos insetIos className="mt-8">
        <DangerListButton onClick={remove}>{COPY.todo.deleteTodo}</DangerListButton>
      </List>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={cancelOpen} onBackdropClick={() => setCancelOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold mb-2">{COPY.todo.cancelReason}</div>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={COPY.todo.cancelReasonPlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 p-3 text-[16px] outline-none resize-none"
          />
          <div className="flex justify-end gap-4 py-3">
            <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setCancelOpen(false)}>
              {COPY.planner.cancel}
            </button>
            <button
              type="button"
              className="text-[16px] font-semibold text-red-500 disabled:opacity-40"
              disabled={!reason.trim()}
              onClick={confirmCancel}
            >
              {COPY.todo.confirmCancel}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={postponeOpen} onBackdropClick={() => setPostponeOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3 text-[15px] font-semibold">{COPY.todo.postponeTo}</div>
        <List strongIos insetIos dividersIos className="!my-3">
          {postponeChoices(today, todo.date).map(({ choice, date }) => (
            <ListItem
              key={choice}
              link
              chevron={false}
              title={COPY.todo[choice]}
              after={`${dayjs(date).format("M/D")} ${COPY.planner.weekdays[dayjs(date).day()]}`}
              onClick={() => postpone(date)}
            />
          ))}
          <ListItem
            title={COPY.todo.pickDate}
            after={
              <input
                type="date"
                min={today}
                value=""
                onChange={(event) => postpone(event.target.value)}
                className="bg-transparent text-right outline-none"
              />
            }
          />
        </List>
      </Sheet>

      <TagSheet
        opened={tagOpen}
        current={todo.tag}
        usedTags={usedTags}
        inputRef={tagInputRef}
        onClose={() => setTagOpen(false)}
        onPick={(tag) => {
          if (tag !== todo.tag) save({ tag });
          setTagOpen(false);
        }}
      />

      <DocPickerSheet
        opened={pickerOpen}
        picked={todo.memos}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          if (!todo.memos.includes(memo)) save({ memos: [...todo.memos, memo] });
          setPickerOpen(false);
        }}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}

/**
 * Sets the todo's tag: type a new one, or pick one already used on other todos (most recent first). Typing
 * narrows the used tags to those containing the text.
 */
function TagSheet({
  opened,
  current,
  usedTags,
  inputRef,
  onClose,
  onPick,
}: {
  opened: boolean;
  current: string;
  usedTags: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onPick: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (opened) setDraft("");
  }, [opened]);
  const typed = draft.trim();
  const matches = usedTags.filter((tag) => tag.includes(typed));
  const isNew = typed !== "" && !usedTags.includes(typed);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (typed) onPick(typed);
  };

  return (
    <Sheet className="pb-safe w-full rounded-t-2xl" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <div className="px-4 pt-3">
        <div className="text-[15px] font-semibold mb-2">{COPY.todo.tag}</div>
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            value={draft}
            maxLength={100}
            enterKeyHint="done"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.todo.tagPlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
        </form>
        {isNew && (
          <button type="button" className="mt-2 text-[16px] text-primary" onClick={() => onPick(typed)}>
            {COPY.todo.useTag(typed)}
          </button>
        )}
        {matches.length > 0 && (
          <>
            <div className="mt-3 mb-2 text-[13px] text-black/45 dark:text-white/45">{COPY.todo.usedTags}</div>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {matches.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onPick(tag)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[14px] border",
                    tag === current
                      ? "bg-primary text-white border-transparent"
                      : "border-black/15 dark:border-white/20 bg-white dark:bg-[#1c1c1e]",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex justify-between py-3">
          {current ? (
            <button type="button" className="text-[16px] text-red-500" onClick={() => onPick("")}>
              {COPY.todo.clearTag}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={onClose}>
            {COPY.planner.cancel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
