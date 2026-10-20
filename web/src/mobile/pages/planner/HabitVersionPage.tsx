import { Code, ConnectError } from "@connectrpc/connect";
import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Stepper, Toast } from "konsta/react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useCreateHabit,
  useDeleteHabitVersion,
  useHabits,
  useHabitVersions,
  useOpenTodos,
  useSetHabitVersion,
  useUpdateHabit,
} from "@/hooks/usePlannerQueries";
import type { Habit } from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import HabitEditSheet from "../../components/planner/HabitEditSheet";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel } from "../../lib/nav";
import { colorsTakenFor, habitColor, habitVersionOn, localToday, versionLabel } from "../../lib/planner";
import { MOBILE_ROUTES } from "../../routes";

// The server's limits: five habits a version, a goal of at most every day.
const MAX_HABITS = 5;
const MAX_WEEKLY_GOAL = 7;

type Entry = { habit: string; weeklyGoal: number };

const Hint = ({ children, danger }: { children: ReactNode; danger?: boolean }) => (
  <p className={`px-8 mt-2 text-[13px] leading-snug ${danger ? "text-red-500" : "text-black/45 dark:text-white/45"}`}>{children}</p>
);

/**
 * One habit version (requirement §2.4.2 §2, §8). Without `?date` it revises: a new version, from today
 * by default, starting from the one in use. With `?date` it opens that version: one not yet in effect can be
 * changed or deleted, one in effect is only shown (`-` names the very first, effective from the beginning).
 */
export default function HabitVersionPage() {
  const back = useBack(MOBILE_ROUTES.PLAN_SETTINGS);
  const backText = useBackLabel() ?? COPY.plannerSettings.title;
  const [params] = useSearchParams();
  const param = params.get("date");
  const opened = param === null ? undefined : param === "-" ? "" : param;
  const today = localToday();
  const { data: habits = [] } = useHabits();
  const { data: versions } = useHabitVersions();
  const { data: openTodos = [] } = useOpenTodos();
  const setVersion = useSetHabitVersion();
  const deleteVersion = useDeleteHabitVersion();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const readonly = opened !== undefined && opened <= today;

  const [effectiveDate, setEffectiveDate] = useState(opened ?? today);
  const [entries, setEntries] = useState<Entry[]>();
  // Starts from the version opened, or, for a revision, from the one in use today.
  useEffect(() => {
    if (entries || !versions) return;
    const base = opened !== undefined ? versions.find((v) => v.effectiveDate === opened) : habitVersionOn(versions, today);
    setEntries(base?.entries.map((entry) => ({ habit: entry.habit, weeklyGoal: entry.weeklyGoal })) ?? []);
  }, [entries, versions, opened, today]);

  const [editing, setEditing] = useState<Habit | null>();
  useBlurOnClose(editing !== undefined);
  const [toast, setToast] = useState("");
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2000);
  };

  const header = (
    <Navbar
      title={
        opened === undefined
          ? COPY.plannerSettings.reviseTitle
          : versionLabel(opened, today, COPY.plannerSettings.fromBeginning, COPY.plannerSettings.from)
      }
      left={<NavbarBackLink text={backText} showText onClick={back} />}
    />
  );
  if (!entries || !versions) {
    return (
      <Page>
        {header}
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      </Page>
    );
  }

  const habitByName = new Map(habits.map((habit) => [habit.name, habit]));
  const picked = new Set(entries.map((entry) => entry.habit));
  const pool = habits.filter((habit) => !picked.has(habit.name));
  const colors = entries.map((entry) => habitByName.get(entry.habit)?.color);
  const sameColor = colors.some((color, i) => color !== undefined && colors.indexOf(color) !== i);

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
    // Open habit todos from the effective date until the next version lose their habit if it is dropped
    // (§2.4.2 §2): ask first, as the server does.
    const kept = new Set(entries.map((entry) => entry.habit));
    const next = versions.find((version) => version.effectiveDate > effectiveDate)?.effectiveDate;
    const dropped = openTodos.filter(
      (todo) => todo.habit !== "" && !kept.has(todo.habit) && todo.date >= effectiveDate && (!next || todo.date < next),
    );
    if (dropped.length > 0 && !window.confirm(COPY.plannerSettings.unlinkConfirm(dropped.map((todo) => todo.title)))) return;
    try {
      await setVersion.mutateAsync({ effectiveDate, entries, localDate: today, unlinkTodos: dropped.length > 0 });
      back();
    } catch {
      flash(COPY.planner.failed);
    }
  };

  const remove = () => {
    if (opened === undefined || !window.confirm(COPY.plannerSettings.deleteVersionConfirm)) return;
    deleteVersion.mutate(
      { effectiveDate: opened, localDate: today },
      {
        onSuccess: back,
        onError: (err) =>
          flash(
            err instanceof ConnectError && err.code === Code.FailedPrecondition
              ? COPY.plannerSettings.deleteVersionBlocked
              : COPY.planner.failed,
          ),
      },
    );
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
  // A color is taken when a habit of this draft, or of a saved version with this habit, already has it.
  const takenColors = (habit: Habit) =>
    new Set([
      ...colorsTakenFor(habit.name, habits, versions, today),
      ...entries.flatMap((entry) => (entry.habit !== habit.name ? (habitByName.get(entry.habit)?.color ?? []) : [])),
    ]);

  return (
    <Page className="pb-safe">
      {header}

      <SectionTitle>{COPY.plannerSettings.effectiveDate}</SectionTitle>
      <List strongIos insetIos className="!my-0">
        <ListItem
          title={COPY.plannerSettings.effectiveDate}
          after={
            opened === undefined ? (
              <input
                type="date"
                min={today}
                value={effectiveDate}
                onChange={(event) => event.target.value >= today && setEffectiveDate(event.target.value)}
                className="bg-transparent text-right outline-none"
              />
            ) : (
              versionLabel(opened, today, COPY.plannerSettings.fromBeginning, COPY.plannerSettings.from)
            )
          }
        />
      </List>
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

          <List strongIos insetIos className="mt-8">
            <ListButton onClick={save} className={sameColor || setVersion.isPending ? "pointer-events-none opacity-40" : undefined}>
              {COPY.planner.save}
            </ListButton>
          </List>
          {opened !== undefined && (
            <List strongIos insetIos className="mt-4">
              <DangerListButton onClick={remove}>{COPY.plannerSettings.deleteVersion}</DangerListButton>
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

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
