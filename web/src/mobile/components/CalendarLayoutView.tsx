import dayjs from "dayjs";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTodayDate } from "@/components/ActivityCalendar/hooks";
import { useCalendarMatrix } from "@/components/ActivityCalendar/useCalendar";
import { calendarDocLabel, docColor } from "@/components/GalleryView/calendar";
import { propertyMap } from "@/components/GalleryView/fields";
import type { CalendarLayoutBlock } from "@/components/GalleryView/types";
import { useCalendarDocs } from "@/components/GalleryView/useScopeMemos";
import { useInstance } from "@/contexts/InstanceContext";
import { cn } from "@/lib/utils";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { COPY } from "../copy";
import DocGlyph from "./DocGlyph";

interface Props {
  block: CalendarLayoutBlock;
  view: Memo;
  /** Keeps several calendars in one view apart when remembering where each was left. */
  blockIndex: number;
  onOpen: (memoName: string) => void;
}

const MAX_DOTS = 3;
// A stable, mutable copy for the shared matrix hook (it memoizes on the array).
const WEEKDAYS = [...COPY.reader.viewCalendarWeekdays];

// Where each calendar was left (month and selected day), so coming back from a document opened off the
// day list lands on the same day. Kept in memory for the day it was saved, like the planner's calendar.
const savedPositions = new Map<string, { month: string; selectedDate: string; savedOn: string }>();

/**
 * A calendar layout block on the phone, read-only (phase 3 §4): the month grid on top with a dot per
 * document on its day (in the document's `color` when it has one), and the selected day's documents
 * listed below; tapping one opens it in the reader. Documents land on the same days as on the web
 * (`useCalendarDocs`); the phone always shows days, also for blocks set to weeks.
 */
export default function CalendarLayoutView({ block, view, blockIndex, onOpen }: Props) {
  const { generalSetting } = useInstance();
  const today = useTodayDate();
  const { docsByDate, isLoading } = useCalendarDocs(block, view);

  const positionKey = `${view.name}#${blockIndex}`;
  const [position] = useState(() => {
    const saved = savedPositions.get(positionKey);
    return saved?.savedOn === today ? saved : undefined;
  });
  const [month, setMonth] = useState(position?.month ?? dayjs(today).format("YYYY-MM"));
  const [selectedDate, setSelectedDate] = useState(position?.selectedDate ?? today);
  useEffect(() => {
    savedPositions.set(positionKey, { month, selectedDate, savedOn: today });
  }, [positionKey, month, selectedDate, today]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [date, list] of docsByDate) c[date] = list.length;
    return c;
  }, [docsByDate]);
  const { weeks, weekDays } = useCalendarMatrix({
    month,
    data: counts,
    weekDays: WEEKDAYS,
    weekStartDayOffset: generalSetting.weekStartDayOffset,
    today,
    selectedDate,
  });

  const shiftMonth = (delta: number) => setMonth(dayjs(`${month}-01`).add(delta, "month").format("YYYY-MM"));
  const goToday = () => {
    setMonth(dayjs(today).format("YYYY-MM"));
    setSelectedDate(today);
  };
  const isCurrentMonth = month === dayjs(today).format("YYYY-MM");

  const selected = dayjs(selectedDate);
  const dayTitle = `${selected.format("M月D日")} ${COPY.planner.weekdays[selected.day()]}${selectedDate === today ? ` · ${COPY.planner.today}` : ""}`;
  const dayDocs = docsByDate.get(selectedDate) ?? [];

  return (
    <div className="flex flex-col gap-3 not-prose">
      <div className="rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] p-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[17px] font-semibold">{dayjs(`${month}-01`).format("YYYY年M月")}</span>
          <div className="flex items-center gap-1 text-primary">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label={COPY.reader.viewCalendarPrev}
              className="p-1.5 active:opacity-50"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goToday}
              disabled={isCurrentMonth && selectedDate === today}
              className="px-1.5 py-1 text-[15px] active:opacity-50 disabled:text-black/25 dark:disabled:text-white/25"
            >
              {COPY.planner.today}
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={COPY.reader.viewCalendarNext}
              className="p-1.5 active:opacity-50"
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7">
          {weekDays.map((label, i) => (
            <div key={i} className="pb-1 text-center text-[12px] text-black/40 dark:text-white/40">
              {label}
            </div>
          ))}
          {weeks
            .flatMap((week) => week.days)
            .map((day) => {
              if (!day.isCurrentMonth) {
                return (
                  <div key={day.date} className="flex h-12 justify-center pt-1 text-[15px] text-black/20 dark:text-white/20" aria-hidden>
                    {day.label}
                  </div>
                );
              }
              const docs = docsByDate.get(day.date) ?? [];
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setSelectedDate(day.date)}
                  className="flex h-12 flex-col items-center gap-1 pt-1 active:opacity-60"
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-[15px]",
                      day.isSelected ? "bg-primary text-primary-foreground font-semibold" : day.isToday && "text-primary font-semibold",
                    )}
                  >
                    {day.label}
                  </span>
                  <DayMarks docs={docs} />
                </button>
              );
            })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 px-1 text-[15px] font-medium">
          <CalendarDaysIcon className="w-4 h-4 text-primary" />
          {dayTitle}
        </div>
        {isLoading ? (
          <div className="px-1 text-[15px] text-black/45 dark:text-white/45">{COPY.reader.viewLoading}</div>
        ) : dayDocs.length === 0 ? (
          <div className="px-1 text-[15px] text-black/45 dark:text-white/45">{COPY.reader.viewCalendarDayEmpty}</div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] divide-y divide-black/10 dark:divide-white/10">
            {dayDocs.map((doc) => {
              const color = docColor(propertyMap(doc.content));
              return (
                <button
                  key={doc.name}
                  type="button"
                  onClick={() => onOpen(doc.name)}
                  className="relative flex items-center gap-2.5 px-3.5 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  {color && <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} aria-hidden />}
                  <DocGlyph icon={doc.icon} docType={Memo_DocType[doc.docType]} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[16px]">{calendarDocLabel(doc, block)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Under a day's number: a dot per document (up to three), or the count when there are more. */
function DayMarks({ docs }: { docs: Memo[] }) {
  if (docs.length === 0) return null;
  if (docs.length > MAX_DOTS) return <span className="text-[10px] font-medium leading-none text-primary">{docs.length}</span>;
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {docs.map((doc) => {
        const color = docColor(propertyMap(doc.content));
        return (
          <span
            key={doc.name}
            className={cn("h-1.5 w-1.5 rounded-full", !color && "bg-primary/70")}
            style={color ? { backgroundColor: color } : undefined}
          />
        );
      })}
    </span>
  );
}
