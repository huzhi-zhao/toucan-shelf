import { create } from "@bufbuild/protobuf";
import { List, ListButton, ListItem } from "konsta/react";
import { useEffect, useMemo, useState } from "react";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { useRecentWorkouts } from "@/hooks/usePlannerQueries";
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
}

/**
 * An exercise in the list. A name linked to a live guide is a link to it (requirement §2.4.4 §4); the rest of
 * the row edits the exercise. An archived, deleted or unreadable guide leaves the name as plain text.
 */
function ExerciseRow({
  exercise,
  onEdit,
  onOpenDoc,
}: {
  exercise: WorkoutExercise;
  onEdit?: () => void;
  onOpenDoc?: (memo: string) => void;
}) {
  const { data: guide } = useMemoQuery(exercise.doc, { enabled: Boolean(exercise.doc && onOpenDoc) });
  const linked = Boolean(onOpenDoc) && guide?.state === State.NORMAL;
  return (
    <ListItem
      link={Boolean(onEdit)}
      title={
        linked ? (
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
        )
      }
      text={<span className="whitespace-normal">{[exerciseSummary(exercise), exercise.note].filter(Boolean).join(" — ")}</span>}
      onClick={onEdit}
    />
  );
}

/**
 * A workout's total length and exercises (requirement §2.4.4 §4): a check-in's record of what was done, or a
 * habit todo's plan of what to do (§2.4.5). Tapping an exercise edits it in a sheet, except its name when that
 * links a guide, which opens the guide; the length saves on blur.
 */
export default function WorkoutEditor({ workout, onChange, readOnly, emptyText, onOpenDoc, habit }: Props) {
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
      <List strongIos insetIos dividersIos className="!my-0">
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
