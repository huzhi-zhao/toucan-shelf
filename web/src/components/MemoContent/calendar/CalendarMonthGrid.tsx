import dayjs from "dayjs";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";
import { useTodayDate, useWeekdayLabels } from "@/components/ActivityCalendar/hooks";
import { useCalendarMatrix } from "@/components/ActivityCalendar/useCalendar";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/contexts/InstanceContext";
import { addMonths, formatMonth } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { CalendarDayCell } from "./CalendarDayCell";
import type { VisibleMonth } from "./defaultVisibleMonth";
import type { CalendarItem } from "./parseCalendarBlock";

interface CalendarMonthGridProps {
  month: VisibleMonth;
  onMonthChange: (month: VisibleMonth) => void;
  itemCounts: Record<string, number>;
  itemsByDate: Record<string, CalendarItem[]>;
  eventsByDate: Record<string, string[]>;
  events: string[];
  showTaskDot: boolean;
  selectedDate?: string;
  onSelectDate: (date: string) => void;
}

const toMonthString = (month: VisibleMonth) => formatMonth(new Date(month.year, month.month, 1));

const toVisibleMonth = (monthString: string): VisibleMonth => {
  const d = dayjs(monthString);
  return { year: d.year(), month: d.month() };
};

export const CalendarMonthGrid = ({
  month,
  onMonthChange,
  itemCounts,
  itemsByDate,
  eventsByDate,
  events,
  showTaskDot,
  selectedDate,
  onSelectDate,
}: CalendarMonthGridProps) => {
  const t = useTranslate();
  const { generalSetting } = useInstance();
  const today = useTodayDate();
  const weekDays = useWeekdayLabels();

  const monthString = toMonthString(month);
  const monthLabel = useMemo(() => dayjs(monthString).format("MMM YYYY"), [monthString]);
  const isViewingCurrentMonth = monthString === formatMonth(new Date());

  const { weeks, weekDays: rotatedWeekDays } = useCalendarMatrix({
    month: monthString,
    data: itemCounts,
    weekDays,
    weekStartDayOffset: generalSetting.weekStartDayOffset,
    today,
    selectedDate: selectedDate ?? "",
  });

  const flatDays = useMemo(() => weeks.flatMap((week) => week.days), [weeks]);

  const handlePrev = () => onMonthChange(toVisibleMonth(addMonths(monthString, -1)));
  const handleNext = () => onMonthChange(toVisibleMonth(addMonths(monthString, 1)));
  const handleToday = () => onMonthChange(toVisibleMonth(today));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-foreground">{monthLabel}</span>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/30 bg-muted/10 p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            aria-label="Previous month"
            className="h-6 w-6 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToday}
            disabled={isViewingCurrentMonth}
            aria-label="Jump to current month"
            className={cn(
              "h-6 px-2 rounded-md text-[10px] font-medium uppercase tracking-wider",
              isViewingCurrentMonth
                ? "text-muted-foreground/50 cursor-default"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {t("common.today")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            aria-label="Next month"
            className="h-6 w-6 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1" role="row">
        {rotatedWeekDays.map((label, index) => (
          <div
            key={index}
            className="flex h-4 items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground/60"
            role="columnheader"
            aria-label={label}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="rowgroup">
        {flatDays.map((day) => (
          <CalendarDayCell
            key={day.date}
            day={day}
            items={itemsByDate[day.date] ?? []}
            dayEvents={eventsByDate[day.date] ?? []}
            events={events}
            showTaskDot={showTaskDot}
            onClick={day.isCurrentMonth ? onSelectDate : undefined}
          />
        ))}
      </div>
    </div>
  );
};
