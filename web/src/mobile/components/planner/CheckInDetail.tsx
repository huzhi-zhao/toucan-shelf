import { create } from "@bufbuild/protobuf";
import { List, ListItem } from "konsta/react";
import { BotIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSetCheckIn } from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import {
  type CheckIn,
  CheckIn_Source,
  type Todo,
  Todo_Source,
  type Workout,
  type WorkoutExercise,
  WorkoutExerciseSchema,
  WorkoutSchema,
} from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../../copy";
import { recordedPlanExercises } from "../../lib/workoutFields";
import DangerListButton from "../DangerListButton";
import SectionTitle from "../SectionTitle";
import PlanProgress from "./PlanProgress";
import RatingStars from "./RatingStars";
import WorkoutEditor, { ExerciseRow, PLANNED_LIST_CLASS, RecordedMark } from "./WorkoutEditor";

/**
 * A check-in, the same on its own page and on the habit todo it completed (requirement §2.4.4, §2.4.5 §4): who
 * made it, its rating and note, what was done (打卡明细), and, for a todo's check-in, the todo's plan folded to
 * one line, each planned exercise either already in the record or one tap from it. A check-in made by completing
 * a todo in the app keeps the todo's title as its note and goes only with the todo.
 */
export default function CheckInDetail({
  checkIn,
  todo,
  onOpenDoc,
  onRemoved,
  onFail,
  readOnly = false,
}: {
  checkIn: CheckIn;
  /** Past the days check-ins stay editable: everything shows, nothing changes. */
  readOnly?: boolean;
  /** The habit todo it completed, for its plan. */
  todo?: Todo;
  onOpenDoc: (memo: string) => void;
  onRemoved: () => void;
  onFail: () => void;
}) {
  const setCheckIn = useSetCheckIn();
  const recorded = checkIn.workout;
  const plannedExercises = todo?.plannedWorkout?.exercises ?? [];
  const inRecord = recordedPlanExercises(plannedExercises, recorded?.exercises ?? []);
  const isAgent = checkIn.source === CheckIn_Source.AGENT;
  // The note of a todo's check-in is the todo's title; one an agent made completing a todo is still the user's.
  const noteLocked = (!!checkIn.todo && !isAgent) || readOnly;
  const [planOpen, setPlanOpen] = useState(false);

  const [note, setNote] = useState(checkIn.note);
  useEffect(() => setNote(checkIn.note), [checkIn.note]);
  // The note wraps and grows with its text, so a long one reads in full.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = noteRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [note]);

  // Every change resends the note and the whole workout, as the server replaces them; the rating only when it changes.
  const save = (changes: { note?: string; workout?: Workout; rating?: number }) =>
    setCheckIn.mutate(
      {
        habit: checkIn.habit,
        date: checkIn.date,
        note: changes.note ?? note,
        checked: true,
        workout: changes.workout ?? recorded ?? create(WorkoutSchema, {}),
        rating: changes.rating,
      },
      { onError: onFail },
    );
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
    setCheckIn.mutate({ habit: checkIn.habit, date: checkIn.date, checked: false }, { onSuccess: onRemoved, onError: onFail });
  };

  return (
    <>
      <SectionTitle>{COPY.checkIn.section}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        <ListItem
          title={COPY.checkIn.source}
          after={
            <span className="inline-flex items-center gap-1">
              {isAgent && <BotIcon className="w-4 h-4" />}
              {COPY.checkIn.sources[CheckIn_Source[checkIn.source]] ?? ""}
            </span>
          }
        />
        <ListItem
          title={COPY.checkIn.rating}
          after={<RatingStars value={checkIn.rating ?? 0} onChange={readOnly ? undefined : (rating) => save({ rating })} />}
        />
        {/* A plain row, not a ListItem: its title shrinks to its content, and the note should span the row. */}
        <li className="px-4 py-3">
          <textarea
            ref={noteRef}
            rows={1}
            value={note}
            disabled={noteLocked}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => note.trim() !== checkIn.note && save({ note: note.trim() })}
            placeholder={COPY.checkIn.notePlaceholder}
            aria-label={COPY.checkIn.note}
            className="block w-full bg-transparent text-[16px] leading-relaxed outline-none resize-none overflow-hidden whitespace-pre-wrap disabled:opacity-60"
          />
        </li>
      </List>
      {(isAgent || noteLocked) && !readOnly && (
        <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">
          {isAgent ? COPY.checkIn.agentHint : COPY.checkIn.noteLocked}
        </p>
      )}

      <SectionTitle>{COPY.checkIn.workout}</SectionTitle>
      <WorkoutEditor
        workout={recorded}
        habit={checkIn.habit}
        onChange={(workout) => save({ workout })}
        readOnly={readOnly}
        emptyText={COPY.checkIn.noExercises}
        onOpenDoc={onOpenDoc}
      />

      {plannedExercises.length > 0 && (
        <>
          <SectionTitle>{COPY.checkIn.plan}</SectionTitle>
          <List strongIos insetIos dividersIos className={cn("!my-0", PLANNED_LIST_CLASS)}>
            <ListItem
              link
              chevron={false}
              title={
                <span className="inline-flex items-center gap-1.5 text-black/60 dark:text-white/60">
                  {COPY.checkIn.planSummary(plannedExercises.length)}
                  {todo?.plannedWorkoutSource === Todo_Source.AGENT && (
                    <BotIcon className="w-4 h-4" aria-label={COPY.checkIn.sources.AGENT} />
                  )}
                  <PlanProgress inRecord={inRecord} />
                </span>
              }
              after={<ChevronDownIcon className={cn("w-5 h-5 transition-transform", planOpen && "rotate-180")} />}
              onClick={() => setPlanOpen((open) => !open)}
            />
            {planOpen &&
              plannedExercises.map((exercise, index) => (
                <ExerciseRow
                  key={`${index}-${exercise.name}`}
                  exercise={exercise}
                  planned
                  dimmed={inRecord[index]}
                  onOpenDoc={onOpenDoc}
                  after={
                    inRecord[index] ? (
                      <RecordedMark />
                    ) : readOnly ? undefined : (
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
          {planOpen && inRecord.includes(false) && !readOnly && (
            <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{COPY.checkIn.planHint}</p>
          )}
        </>
      )}

      {!noteLocked && (
        <List strongIos insetIos className="mt-8">
          <DangerListButton onClick={remove}>{checkIn.todo ? COPY.checkIn.undo : COPY.checkIn.remove}</DangerListButton>
        </List>
      )}
    </>
  );
}
