import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Radio, Stepper, Toast } from "konsta/react";
import { type ReactNode, useState } from "react";
import { useHabitPlans, useHabits, useUpdateHabit } from "@/hooks/usePlannerQueries";
import type { Habit } from "@/types/proto/api/v1/planner_service_pb";
import { LinkedDocsList } from "../../components/LinkedDocs";
import HabitEditSheet from "../../components/planner/HabitEditSheet";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import {
  colorsTakenFor,
  habitColor,
  habitVersionOn,
  localToday,
  PLANNER_MAX_UPDATE_DAYS_DEFAULT,
  PLANNER_MAX_UPDATE_DAYS_KEY,
  PLANNER_WEEK_START_KEY,
  versionLabel,
} from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { docRoute, habitVersionRoute, MOBILE_ROUTES } from "../../routes";

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

/**
 * Planner preferences on this phone, and the habits (requirement §2.2, §2.4.2 §8): the version in use today,
 * a way to revise it, and every version so far, which is where past habits are seen.
 */
export default function PlannerSettingsPage() {
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.plannerSettings.title);
  const [weekStart, setWeekStart] = usePref(PLANNER_WEEK_START_KEY, 0);
  const [maxUpdateDays, setMaxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  const today = localToday();
  const { data: habits = [] } = useHabits();
  const { data: plans } = useHabitPlans();
  const versions = plans?.versions ?? [];
  const draft = plans?.draft;
  const updateHabit = useUpdateHabit();
  const habitByName = new Map(habits.map((habit) => [habit.name, habit]));
  const current = habitVersionOn(versions, today);
  const label = (effectiveDate: string) =>
    versionLabel(effectiveDate, today, COPY.plannerSettings.fromBeginning, COPY.plannerSettings.from);

  const [editing, setEditing] = useState<Habit>();
  useBlurOnClose(editing !== undefined);
  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  const saveHabit = ({ title, color }: { title: string; color?: number }) => {
    if (!editing) return;
    updateHabit.mutate(
      { name: editing.name, title: title !== editing.title ? title : undefined, color: color !== editing.color ? color : undefined },
      { onError: fail },
    );
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

      <SectionTitle>
        {current ? COPY.plannerSettings.currentVersion(label(current.effectiveDate)) : COPY.plannerSettings.habits}
      </SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {current?.entries.map((entry) => {
          const habit = habitByName.get(entry.habit);
          if (!habit) return null;
          return (
            <ListItem
              key={entry.habit}
              link
              media={<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: habitColor(habit) }} />}
              title={habit.title}
              after={COPY.plannerSettings.weeklyGoal(entry.weeklyGoal)}
              onClick={() => setEditing(habit)}
            />
          );
        })}
      </List>
      {current && current.memos.length > 0 && (
        <>
          <div className="px-8 mt-4 pb-1.5 text-[13px] text-black/45 dark:text-white/45">{COPY.plannerSettings.docs}</div>
          <LinkedDocsList memos={current.memos} onOpen={(memo) => go(docRoute(memo))} />
        </>
      )}

      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        {draft ? (
          <ListItem
            link
            title={COPY.plannerSettings.draft}
            text={
              <span className="whitespace-normal">
                {draft.entries
                  .map((entry) => habitByName.get(entry.habit)?.title)
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            }
            onClick={() => go(habitVersionRoute())}
          />
        ) : (
          <ListButton onClick={() => go(habitVersionRoute())}>{COPY.plannerSettings.revise}</ListButton>
        )}
      </List>
      <Hint>{draft ? COPY.plannerSettings.draftHint : current ? COPY.plannerSettings.versionHint : COPY.plannerSettings.noVersion}</Hint>

      {versions.length > 0 && (
        <>
          <SectionTitle>{COPY.plannerSettings.history}</SectionTitle>
          <List strongIos insetIos dividersIos className="!my-0">
            {[...versions].reverse().map((version) => {
              const titles = version.entries.map((entry) => habitByName.get(entry.habit)?.title).filter(Boolean);
              return (
                <ListItem
                  key={version.effectiveDate}
                  link
                  title={label(version.effectiveDate)}
                  after={version.memos.length > 0 ? `📄 ${version.memos.length}` : undefined}
                  text={<span className="whitespace-normal">{titles.join(" · ")}</span>}
                  onClick={() => go(habitVersionRoute(version.effectiveDate || "-"))}
                />
              );
            })}
          </List>
        </>
      )}

      <List strongIos insetIos className="mt-8">
        <ListItem link title={COPY.plannerSettings.import} onClick={() => go(MOBILE_ROUTES.PLAN_IMPORT)} />
      </List>

      <HabitEditSheet
        habit={editing}
        takenColors={editing ? colorsTakenFor(editing.name, habits, versions, today) : new Set()}
        onClose={() => setEditing(undefined)}
        onSave={saveHabit}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
