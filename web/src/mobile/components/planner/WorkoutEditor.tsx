import { create } from "@bufbuild/protobuf";
import { List, ListButton, ListItem } from "konsta/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { useRecentWorkouts } from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Workout, type WorkoutExercise, WorkoutSchema } from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { parseAmount } from "../../lib/planner";
import { exerciseSummary, usedExerciseFields } from "../../lib/workoutFields";
import ExerciseSheet from "./ExerciseSheet";

interface Props {
  workout: Workout | undefined;
  /** Called with the whole workout after every change: the server replaces it as a whole. */
  onChange: (workout: Workout) => void;
  readOnly?: boolean;
  /** Shown when there is no exercise yet. */
  emptyText: string;
  /** Opens an exercise's guide (`memos/{uid}`); without it, names are plain text. */
  onOpenDoc?: (memo: string) => void;
  /** The habit (`planner/habits/{uid}`): its past workouts decide which fields an exercise shows. */
  habit: string;
  /** A plan of what to do rather than a record of what was done: drawn dashed, each exercise tagged 计划. */
  planned?: boolean;
}

/** How a plan is told apart from a record (requirement §2.4.5 §4): a dashed outline around its list. */
export const PLANNED_LIST_CLASS = "outline-1 outline-dashed -outline-offset-1 outline-black/25 dark:outline-white/25";

/**
 * An exercise in the list. A name linked to a live guide is a link to it (requirement §2.4.4 §4); the rest of
 * the row edits the exercise. An archived, deleted or unreadable guide leaves the name as plain text. A planned
 * exercise is tagged 计划 and greyed, so it never reads as done.
 */
export function ExerciseRow({
  exercise,
  onEdit,
  onOpenDoc,
  planned,
  after,
  dimmed,
}: {
  exercise: WorkoutExercise;
  onEdit?: () => void;
  onOpenDoc?: (memo: string) => void;
  planned?: boolean;
  after?: ReactNode;
  /** Faded further, e.g. a planned exercise already in the record. */
  dimmed?: boolean;
}) {
  const { data: guide } = useMemoQuery(exercise.doc, { enabled: Boolean(exercise.doc && onOpenDoc) });
  const linked = Boolean(onOpenDoc) && guide?.state === State.NORMAL;
  const name = linked ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenDoc?.(exercise.doc);
      }}
      className="-my-1 py-1 text-left text-primary underline decoration-primary/40 underline-offset-4 active:opacity-50"
    >
      {exercise.name}
    </button>
  ) : (
    exercise.name
  );
  return (
    <ListItem
      link={Boolean(onEdit)}
      className={cn(planned && "text-black/60 dark:text-white/60", dimmed && "opacity-50")}
      title={
        planned ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded border border-dashed border-current px-1 text-[11px] leading-4 opacity-70">
              {COPY.checkIn.planTag}
            </span>
            {name}
          </span>
        ) : (
          name
        )
      }
      text={<span className="whitespace-normal">{[exerciseSummary(exercise), exercise.note].filter(Boolean).join(" — ")}</span>}
      after={after}
      onClick={onEdit}
    />
  );
}

/**
 * A workout's total length and exercises (requirement §2.4.4 §4): a check-in's record of what was done, or a
 * habit todo's plan of what to do (§2.4.5). Tapping an exercise edits it in a sheet, except its name when that
 * links a guide, which opens the guide; the length saves on blur.
 */
export default function WorkoutEditor({ workout, onChange, readOnly, emptyText, onOpenDoc, habit, planned }: Props) {
  const exercises = workout?.exercises ?? [];
  const { data: recent } = useRecentWorkouts(readOnly ? "" : habit);
  const usedFields = useMemo(() => usedExerciseFields([...(recent ?? []), workout]), [recent, workout]);
  const [duration, setDuration] = useState("");
  useEffect(() => setDuration(workout?.durationMinutes !== undefined ? String(workout.durationMinutes) : ""), [workout]);

  // The exercise being edited: null for a new one, undefined when the sheet is closed.
  const [editing, setEditing] = useState<{ index: number; exercise: WorkoutExercise | null }>();
  useBlurOnClose(editing !== undefined);

  const save = (changes: { duration?: string; exercises?: WorkoutExercise[] }) =>
    onChange(
      create(WorkoutSchema, { durationMinutes: parseAmount(changes.duration ?? duration), exercises: changes.exercises ?? exercises }),
    );

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

  return (
    <>
      <List strongIos insetIos dividersIos className={cn("!my-0", planned && PLANNED_LIST_CLASS)}>
        <ListItem
          title={COPY.checkIn.duration}
          after={
            <input
              value={duration}
              inputMode="decimal"
              readOnly={readOnly}
              onChange={(event) => setDuration(event.target.value)}
              onBlur={() => {
                if (parseAmount(duration) !== workout?.durationMinutes) save({ duration });
              }}
              className="w-20 bg-transparent text-right text-[16px] outline-none"
            />
          }
        />
        {exercises.length === 0 && <ListItem title={<span className="text-black/45 dark:text-white/45">{emptyText}</span>} />}
        {exercises.map((exercise, index) => (
          <ExerciseRow
            key={`${index}-${exercise.name}`}
            exercise={exercise}
            onEdit={readOnly ? undefined : () => setEditing({ index, exercise })}
            onOpenDoc={onOpenDoc}
            planned={planned}
          />
        ))}
        {!readOnly && (
          <ListButton onClick={() => setEditing({ index: exercises.length, exercise: null })}>{COPY.checkIn.addExercise}</ListButton>
        )}
      </List>

      <ExerciseSheet
        usedFields={usedFields}
        exercise={editing?.exercise}
        onClose={() => setEditing(undefined)}
        onSave={saveExercise}
        onRemove={removeExercise}
      />
    </>
  );
}
