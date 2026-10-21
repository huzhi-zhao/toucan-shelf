import { create } from "@bufbuild/protobuf";
import { Sheet } from "konsta/react";
import { useEffect, useState } from "react";
import { type WorkoutExercise, WorkoutExerciseSchema } from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../../copy";
import { formatReps, parseAmount, parseReps } from "../../lib/planner";

interface Props {
  /** Open on an exercise to edit it, or on null to add one; closed when undefined. */
  exercise: WorkoutExercise | null | undefined;
  onClose: () => void;
  onSave: (exercise: WorkoutExercise) => void;
  /** Shown for an existing exercise only. */
  onRemove: () => void;
}

const FIELDS = ["name", "equipment", "weight", "reps", "duration", "settings", "note"] as const;
type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  name: COPY.checkIn.exercise.name,
  equipment: COPY.checkIn.exercise.equipment,
  weight: COPY.checkIn.exercise.weight,
  reps: COPY.checkIn.exercise.reps,
  duration: COPY.checkIn.exercise.duration,
  settings: COPY.checkIn.exercise.settings,
  note: COPY.checkIn.exercise.note,
};

const PLACEHOLDERS: Partial<Record<Field, string>> = {
  name: COPY.checkIn.exercise.namePlaceholder,
  reps: COPY.checkIn.exercise.repsPlaceholder,
  settings: COPY.checkIn.exercise.settingsPlaceholder,
};

const fieldsOf = (exercise: WorkoutExercise | null): Record<Field, string> => ({
  name: exercise?.name ?? "",
  equipment: exercise?.equipment ?? "",
  weight: exercise?.weightKg !== undefined ? String(exercise.weightKg) : "",
  reps: exercise ? formatReps(exercise.reps) : "",
  duration: exercise?.durationMinutes !== undefined ? String(exercise.durationMinutes) : "",
  settings: exercise?.settings ?? "",
  note: exercise?.note ?? "",
});

/** One exercise of a workout (requirement §2.4.4): only the name is required; weight is in kilograms. */
export default function ExerciseSheet({ exercise, onClose, onSave, onRemove }: Props) {
  const [fields, setFields] = useState<Record<Field, string>>(() => fieldsOf(null));
  useEffect(() => {
    if (exercise !== undefined) setFields(fieldsOf(exercise));
  }, [exercise]);
  const set = (field: Field) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [field]: event.target.value }));

  const save = () =>
    onSave(
      create(WorkoutExerciseSchema, {
        name: fields.name.trim(),
        equipment: fields.equipment.trim(),
        weightKg: parseAmount(fields.weight),
        reps: parseReps(fields.reps),
        durationMinutes: parseAmount(fields.duration),
        settings: fields.settings.trim(),
        note: fields.note.trim(),
      }),
    );

  return (
    <Sheet className="pb-safe w-full rounded-t-2xl" opened={exercise !== undefined} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <div className="px-4 pt-3">
        <div className="text-[15px] font-semibold mb-2">{COPY.checkIn.exercise.title}</div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          {FIELDS.map((field) => (
            <label key={field} className="contents">
              <span className="text-[14px] text-black/55 dark:text-white/55">{LABELS[field]}</span>
              <input
                value={fields[field]}
                onChange={set(field)}
                placeholder={PLACEHOLDERS[field]}
                inputMode={field === "weight" || field === "duration" ? "decimal" : undefined}
                className="min-w-0 rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2 text-[16px] outline-none"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-between py-3">
          {exercise ? (
            <button type="button" className="text-[16px] text-red-500" onClick={onRemove}>
              {COPY.checkIn.exercise.remove}
            </button>
          ) : (
            <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={onClose}>
              {COPY.planner.cancel}
            </button>
          )}
          <button
            type="button"
            className="text-[16px] font-semibold text-primary disabled:opacity-40"
            disabled={!fields.name.trim()}
            onClick={save}
          >
            {COPY.planner.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
