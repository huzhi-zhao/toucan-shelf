import { create } from "@bufbuild/protobuf";
import { Sheet } from "konsta/react";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { type WorkoutExercise, WorkoutExerciseSchema } from "@/types/proto/api/v1/planner_service_pb";
import type { ExerciseGuide } from "@/utils/exerciseLibrary";
import { COPY } from "../../copy";
import { formatReps, parseAmount, parseReps } from "../../lib/planner";
import ExercisePickerSheet from "./ExercisePickerSheet";

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

/** The linked guide's title as the sheet shows it, marked when archived; "" while it loads. */
function useGuideLabel(doc: string): string {
  const { data, isError } = useMemoQuery(doc, { enabled: Boolean(doc) });
  if (!doc) return COPY.checkIn.exercise.noGuide;
  if (isError) return COPY.linkedDocs.missing;
  if (!data) return "";
  return data.state === State.ARCHIVED ? `${data.title}${COPY.checkIn.exercise.archived}` : data.title;
}

/**
 * One exercise of a workout (requirement §2.4.4): only the name is required; weight is in kilograms. It can
 * link its guide in the exercise library; picking one fills in the name, which stays editable.
 */
export default function ExerciseSheet({ exercise, onClose, onSave, onRemove }: Props) {
  const [fields, setFields] = useState<Record<Field, string>>(() => fieldsOf(null));
  const [doc, setDoc] = useState("");
  // The title the name was last filled in with from a guide: picking another guide replaces the name only while
  // it still reads that (or is empty), never a name the user typed.
  const [filledName, setFilledName] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (exercise !== undefined) {
      setFields(fieldsOf(exercise));
      setDoc(exercise?.doc ?? "");
      setFilledName("");
      setPicking(false);
    }
  }, [exercise]);
  const set = (field: Field) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [field]: event.target.value }));
  const guideLabel = useGuideLabel(doc);

  const pick = (guide: ExerciseGuide | null) => {
    setPicking(false);
    setDoc(guide?.name ?? "");
    if (!guide) return;
    const name = fields.name.trim();
    if (!name || name === filledName) {
      setFields((f) => ({ ...f, name: guide.title }));
      setFilledName(guide.title);
    }
  };

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
        doc,
      }),
    );

  return (
    <>
      <Sheet className="pb-safe w-full rounded-t-2xl" opened={exercise !== undefined} onBackdropClick={onClose}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold mb-2">{COPY.checkIn.exercise.title}</div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            <span className="text-[14px] text-black/55 dark:text-white/55">{COPY.checkIn.exercise.guide}</span>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex min-w-0 items-center justify-between rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2 text-left text-[16px] active:opacity-60"
            >
              <span className={doc ? "truncate" : "truncate text-black/40 dark:text-white/40"}>{guideLabel || "…"}</span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30" />
            </button>
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
      {/* A sibling, not a child: the sheet is transformed, which would pin a nested fixed sheet inside it. */}
      <ExercisePickerSheet opened={picking} picked={doc} onClose={() => setPicking(false)} onPick={pick} />
    </>
  );
}
