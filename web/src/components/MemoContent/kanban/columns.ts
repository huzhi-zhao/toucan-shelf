import type { KanbanData, KanbanTask } from "./types";

// Which column each task lands in and in what order is shared by the web board
// and the mobile reader's read-only preview (mobile-phase3.md §4), so both
// always show the same board.

/** Column key for tasks missing the groupBy field; each surface titles it ("Ungrouped") itself. */
export const UNGROUPED_KEY = "__ungrouped__";

/** A column shows this many cards before the rest fold behind a "show more" toggle. */
export const COLLAPSED_LIMIT = 6;

export interface KanbanColumnData {
  key: string;
  tasks: KanbanTask[];
}

// Reads the column key for a task from the configured groupBy field. Falls back
// to a sentinel for tasks missing that field, rendered as an "Ungrouped" column.
function groupKey(task: KanbanTask, groupBy: string): string {
  if (groupBy === "status") return task.status ?? UNGROUPED_KEY;
  const value = (task as unknown as Record<string, unknown>)[groupBy] ?? task.custom[groupBy];
  return value == null || value === "" ? UNGROUPED_KEY : String(value);
}

function sortWithin(tasks: KanbanTask[], data: KanbanData): KanbanTask[] {
  const { orderBy, descending } = data.view;
  const sorted = [...tasks].sort((a, b) => {
    // Default ordering is by the `order` field when no orderBy is configured.
    const key = orderBy ?? "order";
    const av = (a as unknown as Record<string, unknown>)[key] ?? a.custom[key];
    const bv = (b as unknown as Record<string, unknown>)[key] ?? b.custom[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  });
  return descending ? sorted.reverse() : sorted;
}

/**
 * Groups a board's tasks into columns: the configured `statusOrder` first (empty
 * ones included, so they still show in the intended order), then any other value
 * in first-seen order, each sorted by the view's orderBy.
 */
export function buildKanbanColumns(data: KanbanData): KanbanColumnData[] {
  const { groupBy } = data.view;
  const buckets = new Map<string, KanbanTask[]>();
  // Seed configured columns so empty ones still render in the intended order.
  for (const key of data.statusOrder) {
    buckets.set(key, []);
  }
  for (const task of data.tasks) {
    const key = groupKey(task, groupBy);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(task);
  }
  return Array.from(buckets.entries()).map(([key, tasks]) => ({ key, tasks: sortWithin(tasks, data) }));
}

/** A custom field's value as display text: lists comma-joined, objects as JSON. */
export function formatTaskValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A task's custom fields worth showing in its detail, in source order: empty ones are left out. */
export function taskCustomEntries(task: KanbanTask): [string, unknown][] {
  return Object.entries(task.custom).filter(([, v]) => v !== null && v !== undefined && v !== "");
}
