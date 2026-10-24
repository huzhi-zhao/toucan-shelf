import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import { List, ListItem, Navbar, NavbarBackLink, Page, Preloader, Toast } from "konsta/react";
import { BotIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useHabits, usePlannerEntries, useSetCheckIn, useTodo } from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import {
  CheckIn_Source,
  Todo_Source,
  type Workout,
  type WorkoutExercise,
  WorkoutExerciseSchema,
  WorkoutSchema,
} from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import PlanProgress from "../../components/planner/PlanProgress";
import WorkoutEditor, { ExerciseRow, PLANNED_LIST_CLASS, RecordedMark } from "../../components/planner/WorkoutEditor";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { recordedPlanExercises } from "../../lib/workoutFields";
import { docRoute, habitNameFromUid, MOBILE_ROUTES, todoRoute } from "../../routes";

/**
 * One check-in (requirement §2.4.4): who made it, its note, and the workout it stands for — the session's
 * length and its exercises. Everything here can be changed or removed, including what a bot recorded. A
 * check-in made by completing a todo keeps the todo's title as its note and goes only with the todo.
 */
export default function CheckInPage() {
  const { uid = "", date = "" } = useParams();
  const habitName = habitNameFromUid(uid);
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.checkIn.title);
  const { data: habits = [] } = useHabits();
  const { data: entries, isPending } = usePlannerEntries(date, date);
  const setCheckIn = useSetCheckIn();
  const habit = habits.find((h) => h.name === habitName);
  const checkIn = entries?.checkIns.find((c) => c.habit === habitName && c.date === date);
  // The todo it completed, for the workout that todo planned (requirement §2.4.5 §4).
  const { data: todo } = useTodo(checkIn?.todo || undefined);
  const planned = todo?.plannedWorkout;
  const recorded = checkIn?.workout;
  const plannedExercises = planned?.exercises ?? [];
  const inRecord = recordedPlanExercises(plannedExercises, recorded?.exercises ?? []);
  const isAgent = checkIn?.source === CheckIn_Source.AGENT;
  // The note of a todo's check-in is the todo's title; one an agent made completing a todo is still the user's.
  const noteLocked = !!checkIn?.todo && !isAgent;

  const [note, setNote] = useState("");
  useEffect(() => {
    if (checkIn) setNote(checkIn.note);
  }, [checkIn]);

  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  // Every change saves the whole check-in: its note and the full workout, as the server replaces it.
  const save = (changes: { note?: string; workout?: Workout }) => {
    if (!checkIn) return;
    const workout = changes.workout ?? recorded ?? create(WorkoutSchema, {});
    setCheckIn.mutate({ habit: habitName, date, note: changes.note ?? note, checked: true, workout }, { onError: fail });
  };
  // The plan is never copied on its own (what was not done must not count): each exercise goes in when tapped.
  const recordPlanned = (exercise: WorkoutExercise) =>
    save({
      workout: create(WorkoutSchema, {
        durationMinutes: recorded?.durationMinutes,
        exercises: [...(recorded?.exercises ?? []), create(WorkoutExerciseSchema, exercise)],
      }),
    });
  const remove = () => {
    if (!window.confirm(COPY.checkIn.confirmRemove)) return;
    setCheckIn.mutate({ habit: habitName, date, checked: false }, { onSuccess: back, onError: fail });
  };

  const title = `${habit?.title ?? ""} · ${date ? dayjs(date).format("M月D日") : ""}`;
  const navbar = <Navbar title={title} left={<NavbarBackLink text={backText} showText onClick={back} />} />;
  if (isPending) {
    return (
      <Page>
        {navbar}
        <div className="flex justify-center pt-16">
          <Preloader />
        </div>
      </Page>
    );
  }
  if (!checkIn) {
    return (
      <Page>
        {navbar}
        <div className="px-8 pt-16 text-center text-black/45 dark:text-white/45">{COPY.checkIn.missing}</div>
      </Page>
    );
  }

  return (
    <Page className="pb-safe">
      {navbar}

      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        <ListItem
          title={COPY.checkIn.source}
          after={
            <span className="inline-flex items-center gap-1">
              {isAgent && <BotIcon className="w-4 h-4" />}
              {COPY.checkIn.sources[CheckIn_Source[checkIn.source]] ?? ""}
            </span>
          }
        />
        {checkIn.todo && <ListItem link title={COPY.checkIn.todo} onClick={() => go(todoRoute(checkIn.todo))} />}
      </List>
      {isAgent && <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{COPY.checkIn.agentHint}</p>}

      <SectionTitle>{COPY.checkIn.note}</SectionTitle>
      <div className="mx-4 rounded-xl bg-white dark:bg-[#1c1c1e] px-4 py-3">
        <input
          value={note}
          disabled={noteLocked}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => note.trim() !== checkIn.note && save({ note: note.trim() })}
          placeholder={COPY.checkIn.notePlaceholder}
          className="w-full bg-transparent text-[16px] outline-none disabled:opacity-60"
        />
      </div>
      {noteLocked && <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{COPY.checkIn.noteLocked}</p>}

      <SectionTitle>{COPY.checkIn.workout}</SectionTitle>
      <WorkoutEditor
        workout={recorded}
        habit={habitName}
        onChange={(workout) => save({ workout })}
        emptyText={COPY.checkIn.noExercises}
        onOpenDoc={(memo) => go(docRoute(memo))}
      />
      {plannedExercises.length > 0 && (
        <>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              {COPY.checkIn.plan}
              <PlanProgress inRecord={inRecord} />
              {todo?.plannedWorkoutSource === Todo_Source.AGENT && <BotIcon className="w-4 h-4" aria-label={COPY.checkIn.sources.AGENT} />}
            </span>
          </SectionTitle>
          <List strongIos insetIos dividersIos className={cn("!my-0", PLANNED_LIST_CLASS)}>
            {plannedExercises.map((exercise, index) => (
              <ExerciseRow
                key={`${index}-${exercise.name}`}
                exercise={exercise}
                planned
                dimmed={inRecord[index]}
                onOpenDoc={(memo) => go(docRoute(memo))}
                after={
                  inRecord[index] ? (
                    <RecordedMark />
                  ) : (
                    <button
                      type="button"
                      disabled={setCheckIn.isPending}
                      onClick={() => recordPlanned(exercise)}
                      className="rounded-full bg-primary/10 px-3 py-1 text-[14px] text-primary active:opacity-50 disabled:opacity-40"
                    >
                      {COPY.checkIn.recordPlanned}
                    </button>
                  )
                }
              />
            ))}
          </List>
          <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{COPY.checkIn.planHint}</p>
        </>
      )}

      <List strongIos insetIos className="mt-8">
        {noteLocked ? (
          <ListItem
            title={<span className="text-[14px] text-black/45 dark:text-white/45 whitespace-normal">{COPY.checkIn.removeLocked}</span>}
          />
        ) : (
          <DangerListButton onClick={remove}>{COPY.checkIn.remove}</DangerListButton>
        )}
      </List>

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
