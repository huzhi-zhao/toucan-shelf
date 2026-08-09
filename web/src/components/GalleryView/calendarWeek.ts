import dayjs from "dayjs";

/** One "week 1-5" tile within a month row. */
export interface CalendarWeekCell {
  /** 1-5, week index within the month it was computed for. */
  index: number;
  /** Inclusive `YYYY-MM-DD` range, Monday through Sunday. May spill into the next month. */
  start: string;
  end: string;
  isCurrentWeek: boolean;
  isSelected: boolean;
}

/** One row of the week grid: a month and its (up to 5) week cells. */
export interface CalendarWeekRow {
  /** `YYYY-MM` of the row's month. */
  month: string;
  cells: CalendarWeekCell[];
}

// dayjs().day() is 0=Sunday..6=Saturday; Monday is 1.
const MONDAY = 1;

function firstMondayOfMonth(monthStart: dayjs.Dayjs): dayjs.Dayjs {
  const dow = monthStart.day();
  const offset = (MONDAY - dow + 7) % 7;
  return monthStart.add(offset, "day");
}

/**
 * Builds the (up to 5) week cells for a single month: week 1 starts on the
 * month's first Monday, each subsequent week is the next 7-day span. A week
 * whose start already falls after the month's last day doesn't belong to this
 * month at all and is omitted (rendered as a blank cell by the caller) — this
 * is normally only week 5. A week's own range commonly spills a few days into
 * the next month (or, for week 1, days before the first Monday belong to the
 * previous month's own trailing week instead — see the previous row).
 */
export function weekCellsForMonth(month: string, today: string, selectedWeekStart: string | undefined): CalendarWeekCell[] {
  const monthStart = dayjs(`${month}-01`);
  const monthEnd = monthStart.endOf("month");
  const firstMonday = firstMondayOfMonth(monthStart);

  const cells: CalendarWeekCell[] = [];
  for (let index = 1; index <= 5; index++) {
    const start = firstMonday.add((index - 1) * 7, "day");
    if (start.isAfter(monthEnd, "day")) break;
    const end = start.add(6, "day");
    const startStr = start.format("YYYY-MM-DD");
    const endStr = end.format("YYYY-MM-DD");
    cells.push({
      index,
      start: startStr,
      end: endStr,
      isCurrentWeek: !dayjs(today).isBefore(startStr, "day") && !dayjs(today).isAfter(endStr, "day"),
      isSelected: selectedWeekStart === startStr,
    });
  }
  return cells;
}

/** Builds the 4-row week grid: previous, anchor, next and next-next month. */
export function buildCalendarWeekRows(anchorMonth: string, today: string, selectedWeekStart: string | undefined): CalendarWeekRow[] {
  const anchor = dayjs(`${anchorMonth}-01`);
  return [-1, 0, 1, 2].map((delta) => {
    const month = anchor.add(delta, "month").format("YYYY-MM");
    return { month, cells: weekCellsForMonth(month, today, selectedWeekStart) };
  });
}

/** True when `date` falls within the inclusive `[start, end]` range. */
export function dateInRange(date: string, start: string, end: string): boolean {
  const d = dayjs(date);
  return !d.isBefore(start, "day") && !d.isAfter(end, "day");
}
