import { useEffect } from "react";
import { usePlannerSettings, useUpdatePlannerSettings } from "@/hooks/usePlannerQueries";
import { readPref, writePref } from "./storage";

// Where each phone kept its own week start before the setting moved to the server.
const LEGACY_WEEK_START_KEY = "planner.weekStart";

/**
 * The day planner weeks start on (1 = Monday … 7 = Sunday, 0 to follow the instance; undefined while loading),
 * and how to change it. It lives on the server so the app and API callers split weeks alike (requirement §2.4.3).
 * A phone that still holds a choice of its own hands it over once, while the server has none.
 */
export function usePlannerWeekStart(): [number | undefined, (weekStartDay: number) => void] {
  const { data } = usePlannerSettings();
  const { mutate } = useUpdatePlannerSettings();
  useEffect(() => {
    if (!data || data.weekStartDay !== 0) return;
    const local = readPref(LEGACY_WEEK_START_KEY, 0);
    if (local === 0) return;
    writePref(LEGACY_WEEK_START_KEY, 0);
    mutate(local);
  }, [data, mutate]);
  return [data?.weekStartDay, mutate];
}
