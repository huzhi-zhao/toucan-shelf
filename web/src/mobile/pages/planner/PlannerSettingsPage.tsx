import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Radio, Sheet, Stepper, Toast } from "konsta/react";
import { type ReactNode, useState } from "react";
import { getEventColorByName } from "@/components/MemoContent/calendar/eventColors";
import { useCreateHabit, useHabits, useUpdateHabit } from "@/hooks/usePlannerQueries";
import type { Habit } from "@/types/proto/api/v1/planner_service_pb";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { PLANNER_MAX_UPDATE_DAYS_DEFAULT, PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_WEEK_START_KEY } from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { MOBILE_ROUTES } from "../../routes";

// 0 follows the instance setting; otherwise the calendar grid's 1 = Monday … 7 = Sunday.
const WEEK_START_OPTIONS = [
  { value: 0, label: COPY.plannerSettings.followInstance },
  { value: 1, label: COPY.planner.weekdays[1] },
  { value: 7, label: COPY.planner.weekdays[0] },
  { value: 6, label: COPY.planner.weekdays[6] },
];

// Konsta's BlockFooter tucks itself under the list above with a negative margin, which only works with the
// list's default margins; these lists have none (see SectionTitle).
const Hint = ({ children }: { children: ReactNode }) => (
  <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{children}</p>
);

/** Planner preferences on this phone, and the habit list (requirement §2.2, §2.4). */
export default function PlannerSettingsPage() {
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.plannerSettings.title);
  const [weekStart, setWeekStart] = usePref(PLANNER_WEEK_START_KEY, 0);
  const [maxUpdateDays, setMaxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  const { data: habits = [] } = useHabits();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const titles = habits.map((habit) => habit.title);

  // The habit sheet edits one habit, or creates one when `editing` is null.
  const [editing, setEditing] = useState<Habit | null>();
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  const openHabit = (habit: Habit | null) => {
    setDraft(habit?.title ?? "");
    setEditing(habit);
  };

  const saveHabit = () => {
    const title = draft.trim();
    if (!title) return;
    if (editing) updateHabit.mutate({ name: editing.name, title }, { onError: fail });
    else createHabit.mutate(title, { onError: fail });
    setEditing(undefined);
  };

  const toggleArchived = () => {
    if (!editing) return;
    updateHabit.mutate({ name: editing.name, archived: !editing.archived }, { onError: fail });
    setEditing(undefined);
  };

  return (
    <Page className="pb-safe">
      <Navbar title={COPY.plannerSettings.title} left={<NavbarBackLink text={backText} showText onClick={back} />} />

      <SectionTitle>{COPY.plannerSettings.weekStart}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {WEEK_START_OPTIONS.map((option) => (
          <ListItem
            key={option.value}
            label
            title={option.label}
            after={<Radio component="div" checked={weekStart === option.value} onChange={() => setWeekStart(option.value)} />}
            onClick={() => setWeekStart(option.value)}
          />
        ))}
      </List>
      <Hint>{COPY.plannerSettings.weekStartHint}</Hint>

      <SectionTitle>{COPY.plannerSettings.maxUpdateDays}</SectionTitle>
      <List strongIos insetIos className="!my-0">
        <ListItem
          title={maxUpdateDays === 0 ? "∞" : `${maxUpdateDays}`}
          after={
            <Stepper
              value={maxUpdateDays}
              small
              raised
              onPlus={() => setMaxUpdateDays(Math.min(maxUpdateDays + 1, 365))}
              onMinus={() => setMaxUpdateDays(Math.max(maxUpdateDays - 1, 0))}
            />
          }
        />
      </List>
      <Hint>{COPY.plannerSettings.maxUpdateDaysHint}</Hint>

      <SectionTitle>{COPY.plannerSettings.habits}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {habits.map((habit) => (
          <ListItem
            key={habit.name}
            link
            media={<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getEventColorByName(habit.title, titles) }} />}
            title={<span className={habit.archived ? "text-black/40 dark:text-white/40" : ""}>{habit.title}</span>}
            after={habit.archived ? COPY.plannerSettings.archived : undefined}
            onClick={() => openHabit(habit)}
          />
        ))}
        <ListButton onClick={() => openHabit(null)}>{COPY.plannerSettings.newHabit}</ListButton>
      </List>
      <Hint>{COPY.plannerSettings.habitsHint}</Hint>

      <List strongIos insetIos className="mt-8">
        <ListItem link title={COPY.plannerSettings.import} onClick={() => go(MOBILE_ROUTES.PLAN_IMPORT)} />
      </List>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={editing !== undefined} onBackdropClick={() => setEditing(undefined)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold mb-2">{editing ? editing.title : COPY.plannerSettings.newHabit}</div>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.plannerSettings.habitTitle}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
          <div className="flex justify-between py-3">
            {editing ? (
              <button type="button" className="text-[16px] text-red-500" onClick={toggleArchived}>
                {editing.archived ? COPY.plannerSettings.restore : COPY.plannerSettings.archive}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="text-[16px] font-semibold text-primary disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={saveHabit}
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
