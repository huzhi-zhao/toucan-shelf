import { create } from "@bufbuild/protobuf";
import { Sheet } from "konsta/react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { type WorkoutExercise, WorkoutExerciseSchema } from "@/types/proto/api/v1/planner_service_pb";
import type { ExerciseGuide } from "@/utils/exerciseLibrary";
import { COPY } from "../../copy";
import { ALWAYS_SHOWN_FIELDS, EXERCISE_FIELDS, type ExerciseField } from "../../lib/workoutFields";
import ExercisePickerSheet from "./ExercisePickerSheet";

interface Props {
  /** Open on an exercise to edit it, or on null to add one; closed when undefined. */
  exercise: WorkoutExercise | null | undefined;
  onClose: () => void;
  onSave: (exercise: WorkoutExercise) => void;
  /** Shown for an existing exercise only. */
  onRemove: () => void;
  /** The fields this habit's workouts use, shown up front; the others wait behind "更多字段". */
  usedFields: ReadonlySet<ExerciseField>;
}

const textsOf = (exercise: WorkoutExercise | null): Record<ExerciseField, string> => {
  const source = exercise ?? create(WorkoutExerciseSchema, {});
  return Object.fromEntries(EXERCISE_FIELDS.map((field) => [field.key, field.read(source)])) as Record<ExerciseField, string>;
};

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
export default function ExerciseSheet({ exercise, onClose, onSave, onRemove, usedFields }: Props) {
  const [fields, setFields] = useState<Record<ExerciseField, string>>(() => textsOf(null));
  const [showAll, setShowAll] = useState(false);
  const [doc, setDoc] = useState("");
  // The title the name was last filled in with from a guide: picking another guide replaces the name only while
  // it still reads that (or is empty), never a name the user typed.
  const [filledName, setFilledName] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (exercise !== undefined) {
      setFields(textsOf(exercise));
      setShowAll(false);
      setDoc(exercise?.doc ?? "");
      setFilledName("");
      setPicking(false);
    }
  }, [exercise]);
  const set = (field: ExerciseField) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [field]: event.target.value }));
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

  // A habit's fields come from its past sessions (requirement §2.4.4 §8): the name and note always, what it used
  // before, and anything this exercise already has.
  const [shown, setShown] = useState<Set<ExerciseField>>(new Set());
  useEffect(() => {
    if (exercise === undefined) return;
    const texts = textsOf(exercise);
    setShown(
      new Set(EXERCISE_FIELDS.filter((f) => ALWAYS_SHOWN_FIELDS.has(f.key) || usedFields.has(f.key) || texts[f.key]).map((f) => f.key)),
    );
  }, [exercise, usedFields]);
  const visible = EXERCISE_FIELDS.filter((field) => showAll || shown.has(field.key));
  const hiddenCount = EXERCISE_FIELDS.length - visible.length;

  const save = () =>
    onSave(
      create(WorkoutExerciseSchema, {
        ...Object.assign({}, ...EXERCISE_FIELDS.map((field) => field.write(fields[field.key]))),
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
            {visible.map((field) => (
              <label key={field.key} className="contents">
                <span className="text-[14px] text-black/55 dark:text-white/55">{field.label}</span>
                <input
                  value={fields[field.key]}
                  onChange={set(field.key)}
                  placeholder={field.placeholder}
                  inputMode={field.decimal ? "decimal" : undefined}
                  className="min-w-0 rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2 text-[16px] outline-none"
                />
              </label>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 flex items-center gap-1 text-[14px] text-primary active:opacity-50"
            >
              {COPY.checkIn.exercise.moreFields(hiddenCount)}
              <ChevronDownIcon className="h-4 w-4" />
            </button>
          )}
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
