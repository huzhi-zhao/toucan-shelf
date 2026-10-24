import type { Workout, WorkoutExercise } from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../copy";
import { formatReps, parseAmount, parseReps } from "./planner";

// The fields of a workout's exercise as the app shows them, one row each: the edit sheet's inputs and the list's
// one-line summary both come from this table. Every habit shares the one set of fields (requirement §2.4.4 §8);
// a field is added here plus in the proto, store.PlannerExercise and its server-side check. The linked guide
// (`doc`) is not one of them: it is picked, not typed.

export type ExerciseField = "name" | "equipment" | "weight" | "reps" | "duration" | "settings" | "intensity" | "note";

/** A typed value with values written to the exercise by `write`. */
type ExerciseValues = Partial<
  Pick<WorkoutExercise, "name" | "equipment" | "weightKg" | "reps" | "durationMinutes" | "settings" | "intensity" | "note">
>;

export interface ExerciseFieldDef {
  key: ExerciseField;
  label: string;
  placeholder?: string;
  decimal?: boolean;
  /** The field as typed text; "" when unset. */
  read: (exercise: WorkoutExercise) => string;
  /** The typed text as exercise values. */
  write: (text: string) => ExerciseValues;
  /** How it reads in the list's summary, or undefined to leave it out (the name is the title, the note follows). */
  summary?: (exercise: WorkoutExercise) => string;
}

const amount = (value: number | undefined) => (value !== undefined ? String(value) : "");

export const EXERCISE_FIELDS: ExerciseFieldDef[] = [
  {
    key: "name",
    label: COPY.checkIn.exercise.name,
    placeholder: COPY.checkIn.exercise.namePlaceholder,
    read: (e) => e.name,
    write: (text) => ({ name: text.trim() }),
  },
  {
    key: "equipment",
    label: COPY.checkIn.exercise.equipment,
    read: (e) => e.equipment,
    write: (text) => ({ equipment: text.trim() }),
    summary: (e) => e.equipment,
  },
  {
    key: "weight",
    label: COPY.checkIn.exercise.weight,
    decimal: true,
    read: (e) => amount(e.weightKg),
    write: (text) => ({ weightKg: parseAmount(text) }),
    summary: (e) => (e.weightKg !== undefined ? `${e.weightKg} kg` : ""),
  },
  {
    key: "reps",
    label: COPY.checkIn.exercise.reps,
    placeholder: COPY.checkIn.exercise.repsPlaceholder,
    read: (e) => formatReps(e.reps),
    write: (text) => ({ reps: parseReps(text) }),
    summary: (e) => formatReps(e.reps),
  },
  {
    key: "duration",
    label: COPY.checkIn.exercise.duration,
    decimal: true,
    read: (e) => amount(e.durationMinutes),
    write: (text) => ({ durationMinutes: parseAmount(text) }),
    summary: (e) => (e.durationMinutes !== undefined ? `${e.durationMinutes} 分钟` : ""),
  },
  {
    key: "settings",
    label: COPY.checkIn.exercise.settings,
    placeholder: COPY.checkIn.exercise.settingsPlaceholder,
    read: (e) => e.settings,
    write: (text) => ({ settings: text.trim() }),
    summary: (e) => e.settings,
  },
  {
    key: "intensity",
    label: COPY.checkIn.exercise.intensity,
    placeholder: COPY.checkIn.exercise.intensityPlaceholder,
    read: (e) => e.intensity,
    write: (text) => ({ intensity: text.trim() }),
    summary: (e) => (e.intensity ? `${COPY.checkIn.exercise.intensity} ${e.intensity}` : ""),
  },
  {
    key: "note",
    label: COPY.checkIn.exercise.note,
    read: (e) => e.note,
    write: (text) => ({ note: text.trim() }),
  },
];

/** The fields every exercise shows: the name (required) and the note. The rest show once a habit uses them. */
export const ALWAYS_SHOWN_FIELDS: ReadonlySet<ExerciseField> = new Set(["name", "note"]);

/** An exercise's details in one line, e.g. "哑铃 · 2.3 kg · 15/12/12". */
export function exerciseSummary(exercise: WorkoutExercise): string {
  return EXERCISE_FIELDS.map((field) => field.summary?.(exercise) ?? "")
    .filter(Boolean)
    .join(" · ");
}

/** The fields filled in somewhere in these workouts: what a habit's past sessions used. */
export function usedExerciseFields(workouts: (Workout | undefined)[]): Set<ExerciseField> {
  const used = new Set<ExerciseField>();
  for (const workout of workouts) {
    for (const exercise of workout?.exercises ?? []) {
      for (const field of EXERCISE_FIELDS) {
        if (field.read(exercise) !== "") used.add(field.key);
      }
    }
  }
  return used;
}
