import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Toast } from "konsta/react";
import { BotIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useHabits, usePlannerEntries, useSetCheckIn } from "@/hooks/usePlannerQueries";
import { CheckIn_Source, type WorkoutExercise, WorkoutSchema } from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import ExerciseSheet from "../../components/planner/ExerciseSheet";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { exerciseSummary, parseAmount } from "../../lib/planner";
import { habitNameFromUid, MOBILE_ROUTES, todoRoute } from "../../routes";

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
  const exercises = checkIn?.workout?.exercises ?? [];
  const isAgent = checkIn?.source === CheckIn_Source.AGENT;
  // The note of a todo's check-in is the todo's title; one an agent made completing a todo is still the user's.
  const noteLocked = !!checkIn?.todo && !isAgent;

  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("");
  useEffect(() => {
    if (!checkIn) return;
    setNote(checkIn.note);
    setDuration(checkIn.workout?.durationMinutes !== undefined ? String(checkIn.workout.durationMinutes) : "");
  }, [checkIn]);

  // The exercise being edited: null for a new one, undefined when the sheet is closed.
  const [editing, setEditing] = useState<{ index: number; exercise: WorkoutExercise | null }>();
  useBlurOnClose(editing !== undefined);
  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  // Every change saves the whole check-in: its note and the full workout, as the server replaces it.
  const save = (changes: { note?: string; duration?: string; exercises?: WorkoutExercise[] }) => {
    if (!checkIn) return;
    const workout = create(WorkoutSchema, {
      durationMinutes: parseAmount(changes.duration ?? duration),
      exercises: changes.exercises ?? exercises,
    });
    setCheckIn.mutate({ habit: habitName, date, note: changes.note ?? note, checked: true, workout }, { onError: fail });
  };

  const saveExercise = (exercise: WorkoutExercise) => {
    if (!editing) return;
    const next = [...exercises];
    if (editing.exercise) next[editing.index] = exercise;
    else next.push(exercise);
    save({ exercises: next });
    setEditing(undefined);
  };
  const removeExercise = () => {
    if (!editing) return;
    save({ exercises: exercises.filter((_, i) => i !== editing.index) });
    setEditing(undefined);
  };
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
      <List strongIos insetIos dividersIos className="!my-0">
        <ListItem
          title={COPY.checkIn.duration}
          after={
            <input
              value={duration}
              inputMode="decimal"
              onChange={(event) => setDuration(event.target.value)}
              onBlur={() => {
                if (parseAmount(duration) !== checkIn.workout?.durationMinutes) save({ duration });
              }}
              className="w-20 bg-transparent text-right text-[16px] outline-none"
            />
          }
        />
        {exercises.length === 0 && (
          <ListItem title={<span className="text-black/45 dark:text-white/45">{COPY.checkIn.noExercises}</span>} />
        )}
        {exercises.map((exercise, index) => (
          <ListItem
            key={`${index}-${exercise.name}`}
            link
            title={exercise.name}
            text={<span className="whitespace-normal">{[exerciseSummary(exercise), exercise.note].filter(Boolean).join(" — ")}</span>}
            onClick={() => setEditing({ index, exercise })}
          />
        ))}
        <ListButton onClick={() => setEditing({ index: exercises.length, exercise: null })}>{COPY.checkIn.addExercise}</ListButton>
      </List>

      <List strongIos insetIos className="mt-8">
        {noteLocked ? (
          <ListItem
            title={<span className="text-[14px] text-black/45 dark:text-white/45 whitespace-normal">{COPY.checkIn.removeLocked}</span>}
          />
        ) : (
          <DangerListButton onClick={remove}>{COPY.checkIn.remove}</DangerListButton>
        )}
      </List>

      <ExerciseSheet exercise={editing?.exercise} onClose={() => setEditing(undefined)} onSave={saveExercise} onRemove={removeExercise} />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
