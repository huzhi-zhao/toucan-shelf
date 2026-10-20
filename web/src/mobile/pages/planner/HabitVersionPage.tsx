import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Stepper, Toast } from "konsta/react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useCreateHabit,
  useDeleteHabitDraft,
  useEnableHabitDraft,
  useHabitPlans,
  useHabits,
  useOpenTodos,
  useSaveHabitDraft,
  useUpdateHabit,
} from "@/hooks/usePlannerQueries";
import type { Habit } from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import DocPickerSheet from "../../components/DocPickerSheet";
import { LinkedDocsList } from "../../components/LinkedDocs";
import HabitEditSheet from "../../components/planner/HabitEditSheet";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { colorsTakenFor, habitColor, habitVersionOn, localToday, versionLabel } from "../../lib/planner";
import { docRoute, MOBILE_ROUTES } from "../../routes";

// The server's limits: five habits a plan, a goal of at most every day.
const MAX_HABITS = 5;
const MAX_WEEKLY_GOAL = 7;

type Entry = { habit: string; weeklyGoal: number };
type Plan = { entries: Entry[]; memos: string[] };

const Hint = ({ children, danger }: { children: ReactNode; danger?: boolean }) => (
  <p className={`px-8 mt-2 text-[13px] leading-snug ${danger ? "text-red-500" : "text-black/45 dark:text-white/45"}`}>{children}</p>
);

/**
 * A habit plan (requirement §2.4.2 §2, §8). Without `?date` it is the draft: habits, order, weekly goals and
 * linked documents, saved without taking effect, then enabled from today on — or started from the plan in use
 * when there is no draft yet. With `?date` it shows the plan enabled that day, read-only (`-` names the very
 * first, in use from the beginning).
 */
export default function HabitVersionPage() {
  const back = useBack(MOBILE_ROUTES.PLAN_SETTINGS);
  const backText = useBackLabel() ?? COPY.plannerSettings.title;
  const [params] = useSearchParams();
  const param = params.get("date");
  const opened = param === null ? undefined : param === "-" ? "" : param;
  const readonly = opened !== undefined;
  const today = localToday();
  const label = (effectiveDate: string) =>
    versionLabel(effectiveDate, today, COPY.plannerSettings.fromBeginning, COPY.plannerSettings.from);
  const go = useGo(readonly ? label(opened) : COPY.plannerSettings.draftTitle);
  const { data: habits = [] } = useHabits();
  const { data: plans } = useHabitPlans();
  const { data: openTodos = [] } = useOpenTodos();
  const saveDraft = useSaveHabitDraft();
  const deleteDraft = useDeleteHabitDraft();
  const enableDraft = useEnableHabitDraft();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();

  // Starts from the plan opened, the draft, or else the plan in use today.
  const [plan, setPlan] = useState<Plan>();
  useEffect(() => {
    if (plan || !plans) return;
    const base = readonly ? plans.versions.find((v) => v.effectiveDate === opened) : (plans.draft ?? habitVersionOn(plans.versions, today));
    setPlan({
      entries: base?.entries.map((entry) => ({ habit: entry.habit, weeklyGoal: entry.weeklyGoal })) ?? [],
      memos: [...(base?.memos ?? [])],
    });
  }, [plan, plans, readonly, opened, today]);

  const [editing, setEditing] = useState<Habit | null>();
  const [pickerOpen, setPickerOpen] = useState(false);
  useBlurOnClose(editing !== undefined || pickerOpen);
  const [toast, setToast] = useState("");
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2000);
  };

  const header = (
    <Navbar
      title={readonly ? label(opened) : COPY.plannerSettings.draftTitle}
      left={<NavbarBackLink text={backText} showText onClick={back} />}
    />
  );
  if (!plan || !plans) {
    return (
      <Page>
        {header}
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      </Page>
    );
  }

  const { entries, memos } = plan;
  const setEntries = (next: Entry[]) => setPlan({ ...plan, entries: next });
  const setMemos = (next: string[]) => setPlan({ ...plan, memos: next });
  const habitByName = new Map(habits.map((habit) => [habit.name, habit]));
  const picked = new Set(entries.map((entry) => entry.habit));
  const pool = habits.filter((habit) => !picked.has(habit.name));
  const colors = entries.map((entry) => habitByName.get(entry.habit)?.color);
  const sameColor = colors.some((color, i) => color !== undefined && colors.indexOf(color) !== i);
  const busy = saveDraft.isPending || enableDraft.isPending;

  const add = (habit: string) => {
    if (entries.length >= MAX_HABITS) {
      flash(COPY.plannerSettings.maxHabits(MAX_HABITS));
      return;
    }
    setEntries([...entries, { habit, weeklyGoal: 0 }]);
  };
  const move = (index: number, by: number) => {
    const next = [...entries];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setEntries(next);
  };
  const setGoal = (index: number, weeklyGoal: number) =>
    setEntries(
      entries.map((entry, i) => (i === index ? { ...entry, weeklyGoal: Math.min(Math.max(weeklyGoal, 0), MAX_WEEKLY_GOAL) } : entry)),
    );

  const save = async () => {
    try {
      await saveDraft.mutateAsync({ entries, memos });
      flash(COPY.plannerSettings.draftSaved);
    } catch {
      flash(COPY.planner.failed);
    }
  };

  // Saves what is on screen, then enables it from today. Open habit todos from today on lose their habit
  // if the plan drops it (§2.4.2 §2): ask first, as the server does.
  const enable = async () => {
    const kept = new Set(entries.map((entry) => entry.habit));
    const dropped = openTodos.filter((todo) => todo.habit !== "" && !kept.has(todo.habit) && todo.date >= today);
    const confirmed =
      dropped.length > 0
        ? window.confirm(COPY.plannerSettings.unlinkConfirm(dropped.map((todo) => todo.title)))
        : window.confirm(COPY.plannerSettings.enableConfirm);
    if (!confirmed) return;
    try {
      await saveDraft.mutateAsync({ entries, memos });
      await enableDraft.mutateAsync({ localDate: today, unlinkTodos: dropped.length > 0 });
      back();
    } catch {
      flash(COPY.planner.failed);
    }
  };

  const remove = () => {
    if (!window.confirm(COPY.plannerSettings.deleteDraftConfirm)) return;
    deleteDraft.mutate(undefined, { onSuccess: back, onError: () => flash(COPY.planner.failed) });
  };

  const saveHabit = async ({ title, color }: { title: string; color?: number }) => {
    const habit = editing;
    setEditing(undefined);
    try {
      if (!habit) {
        const created = await createHabit.mutateAsync(title);
        if (entries.length < MAX_HABITS) setEntries([...entries, { habit: created.name, weeklyGoal: 0 }]);
        return;
      }
      await updateHabit.mutateAsync({
        name: habit.name,
        title: title !== habit.title ? title : undefined,
        color: color !== habit.color ? color : undefined,
      });
    } catch {
      flash(COPY.planner.failed);
    }
  };
  // A color is taken when a habit of this plan, or of an enabled plan with this habit, already has it.
  const takenColors = (habit: Habit) =>
    new Set([
      ...colorsTakenFor(habit.name, habits, plans.versions, today),
      ...entries.flatMap((entry) => (entry.habit !== habit.name ? (habitByName.get(entry.habit)?.color ?? []) : [])),
    ]);

  return (
    <Page className="pb-safe">
      {header}

      {readonly && <Hint>{COPY.plannerSettings.versionReadonly}</Hint>}

      <SectionTitle>{COPY.plannerSettings.versionHabits(entries.length, MAX_HABITS)}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {entries.map((entry, index) => {
          const habit = habitByName.get(entry.habit);
          if (!habit) return null;
          return (
            <ListItem
              key={entry.habit}
              media={<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: habitColor(habit) }} />}
              title={
                readonly ? (
                  habit.title
                ) : (
                  <button type="button" className="text-left" onClick={() => setEditing(habit)}>
                    {habit.title}
                  </button>
                )
              }
              after={
                readonly ? (
                  COPY.plannerSettings.weeklyGoal(entry.weeklyGoal)
                ) : (
                  <div className="flex items-center gap-3 text-black/50 dark:text-white/50">
                    <button
                      type="button"
                      aria-label="↑"
                      disabled={index === 0}
                      className="disabled:opacity-25"
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="↓"
                      disabled={index === entries.length - 1}
                      className="disabled:opacity-25"
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={COPY.plannerSettings.removeHabit}
                      className="text-red-500"
                      onClick={() => setEntries(entries.filter((_, i) => i !== index))}
                    >
                      <XIcon className="w-4 h-4" />
                    </button>
                  </div>
                )
              }
              text={
                readonly ? undefined : (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[13px]">{COPY.plannerSettings.weeklyGoal(entry.weeklyGoal)}</span>
                    <Stepper
                      value={entry.weeklyGoal}
                      small
                      raised
                      onPlus={() => setGoal(index, entry.weeklyGoal + 1)}
                      onMinus={() => setGoal(index, entry.weeklyGoal - 1)}
                    />
                  </div>
                )
              }
            />
          );
        })}
      </List>
      {sameColor ? <Hint danger>{COPY.plannerSettings.sameColor}</Hint> : <Hint>{COPY.plannerSettings.versionHabitsHint}</Hint>}

      {!readonly && (
        <>
          <SectionTitle>{COPY.plannerSettings.habitPool}</SectionTitle>
          <List strongIos insetIos dividersIos className="!my-0">
            {pool.map((habit) => (
              <ListItem
                key={habit.name}
                link
                chevron={false}
                media={<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: habitColor(habit) }} />}
                title={habit.title}
                after={<span className="text-primary text-[20px] leading-none">+</span>}
                onClick={() => add(habit.name)}
              />
            ))}
            <ListButton onClick={() => setEditing(null)}>{COPY.plannerSettings.newHabit}</ListButton>
          </List>
          <Hint>{COPY.plannerSettings.habitPoolHint}</Hint>
        </>
      )}

      <SectionTitle>{COPY.plannerSettings.docs}</SectionTitle>
      {readonly && memos.length === 0 ? (
        <div className="px-8 text-[14px] text-black/40 dark:text-white/40">{COPY.plannerSettings.noDocs}</div>
      ) : (
        <LinkedDocsList
          memos={memos}
          onOpen={(memo) => go(docRoute(memo))}
          onRemove={readonly ? undefined : (memo) => setMemos(memos.filter((m) => m !== memo))}
          onAdd={readonly ? undefined : () => setPickerOpen(true)}
        />
      )}
      {!readonly && <Hint>{COPY.plannerSettings.docsHint}</Hint>}

      {!readonly && (
        <>
          <List strongIos insetIos dividersIos className="mt-8">
            <ListButton onClick={save} className={sameColor || busy ? "pointer-events-none opacity-40" : undefined}>
              {COPY.plannerSettings.saveDraft}
            </ListButton>
            <ListButton onClick={enable} className={sameColor || busy ? "pointer-events-none opacity-40" : "font-semibold"}>
              {COPY.plannerSettings.enable}
            </ListButton>
          </List>
          {plans.draft && (
            <List strongIos insetIos className="mt-4">
              <DangerListButton onClick={remove}>{COPY.plannerSettings.deleteDraft}</DangerListButton>
            </List>
          )}
        </>
      )}

      <HabitEditSheet
        habit={editing}
        takenColors={editing ? takenColors(editing) : new Set()}
        onClose={() => setEditing(undefined)}
        onSave={saveHabit}
      />

      <DocPickerSheet
        opened={pickerOpen}
        picked={memos}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          if (!memos.includes(memo)) setMemos([...memos, memo]);
          setPickerOpen(false);
        }}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
