import { Sheet } from "konsta/react";
import { useEffect, useState } from "react";
import { EVENT_COLORS } from "@/components/MemoContent/calendar/eventColors";
import { cn } from "@/lib/utils";
import type { Habit } from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../../copy";
import { isSingleEmoji, joinHabitTitle, splitHabitTitle } from "../../lib/planner";

interface Props {
  /** Open on a habit to edit it, or on null to create one; closed when undefined. */
  habit: Habit | null | undefined;
  /** Colors other habits of its versions use: the habit cannot take them. */
  takenColors: Set<number>;
  onClose: () => void;
  /** `color` is left out for a new habit: the server gives it one no other habit has. */
  onSave: (changes: { title: string; color?: number }) => void;
}

/**
 * A habit's icon, name and, for an existing one, color (requirement §2.4.2 §1). The icon is one emoji and
 * required; the name may be left empty. Both are saved as the title, icon first. Habits are never deleted.
 */
export default function HabitEditSheet({ habit, takenColors, onClose, onSave }: Props) {
  const [icon, setIcon] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(0);
  useEffect(() => {
    if (habit === undefined) return;
    const parts = splitHabitTitle(habit?.title ?? "");
    setIcon(parts.hasEmoji ? parts.icon : "");
    setName(parts.name);
    setColor(habit?.color ?? 0);
  }, [habit]);
  const iconValid = isSingleEmoji(icon);
  const title = joinHabitTitle(icon, name);

  return (
    <Sheet className="pb-safe w-full rounded-t-2xl" opened={habit !== undefined} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <div className="px-4 pt-3">
        <div className="text-[15px] font-semibold mb-2">{habit ? COPY.plannerSettings.editHabit : COPY.plannerSettings.newHabit}</div>
        <div className="flex gap-2">
          <input
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            placeholder={COPY.plannerSettings.habitIcon}
            aria-label={COPY.plannerSettings.habitIcon}
            className="w-16 shrink-0 rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-center text-[20px] outline-none"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={COPY.plannerSettings.habitName}
            aria-label={COPY.plannerSettings.habitName}
            className="min-w-0 flex-1 rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2.5 text-[16px] outline-none"
          />
        </div>
        {icon.trim() !== "" && !iconValid && <div className="mt-1.5 text-[13px] text-red-500">{COPY.plannerSettings.iconInvalid}</div>}
        {habit && (
          <>
            <div className="mt-3 mb-2 text-[13px] text-black/45 dark:text-white/45">{COPY.plannerSettings.color}</div>
            <div className="flex flex-wrap gap-3">
              {EVENT_COLORS.map((swatch, index) => {
                const taken = index !== habit.color && takenColors.has(index);
                return (
                  <button
                    key={swatch}
                    type="button"
                    disabled={taken}
                    aria-label={`${COPY.plannerSettings.color} ${index + 1}`}
                    aria-pressed={color === index}
                    title={taken ? COPY.plannerSettings.colorTaken : undefined}
                    onClick={() => setColor(index)}
                    className={cn(
                      "w-8 h-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c1e]",
                      color === index && "ring-2 ring-black/60 dark:ring-white/70",
                      taken && "opacity-20",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                );
              })}
            </div>
          </>
        )}
        <div className="flex justify-end gap-4 py-3">
          <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={onClose}>
            {COPY.planner.cancel}
          </button>
          <button
            type="button"
            className="text-[16px] font-semibold text-primary disabled:opacity-40"
            disabled={!iconValid}
            onClick={() => onSave(habit ? { title, color } : { title })}
          >
            {COPY.planner.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
