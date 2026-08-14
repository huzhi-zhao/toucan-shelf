import dayjs from "dayjs";
import { ChevronLeftIcon, ChevronRightIcon, FilterIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTodayDate, useWeekdayLabels } from "@/components/ActivityCalendar/hooks";
import { useCalendarMatrix } from "@/components/ActivityCalendar/useCalendar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useInstance } from "@/contexts/InstanceContext";
import { addMonths, formatMonth } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { CalendarDayCell } from "./CalendarDayCell";
import type { VisibleMonth } from "./defaultVisibleMonth";
import type { CalendarItem } from "./parseCalendarBlock";

const TASKS_DOT_KEY = "__tasks__";

interface CalendarMonthGridProps {
  month: VisibleMonth;
  onMonthChange: (month: VisibleMonth) => void;
  itemCounts: Record<string, number>;
  itemsByDate: Record<string, CalendarItem[]>;
  eventsByDate: Record<string, string[]>;
  events: string[];
  showTaskDot: boolean;
  weekStartDay?: number; // 1=周一 …… 6=周六、7=周日；省略时用实例设置
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
  weekStartDay,
  selectedDate,
  onSelectDate,
}: CalendarMonthGridProps) => {
  const t = useTranslate();
  const { generalSetting } = useInstance();
  const today = useTodayDate();
  const weekDays = useWeekdayLabels();

  const dotOptions = useMemo(
    () => [{ key: TASKS_DOT_KEY, label: t("markdown.calendar-block.tasks") }, ...events.map((name) => ({ key: name, label: name }))],
    [events, t],
  );
  const [visibleDots, setVisibleDots] = useState<Set<string>>(() => new Set(dotOptions.map((o) => o.key)));
  const toggleDot = (key: string) => {
    setVisibleDots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const monthString = toMonthString(month);
  const monthLabel = useMemo(() => dayjs(monthString).format("MMM YYYY"), [monthString]);
  const isViewingCurrentMonth = monthString === formatMonth(new Date());

  const { weeks, weekDays: rotatedWeekDays } = useCalendarMatrix({
    month: monthString,
    data: itemCounts,
    weekDays,
    // weekStartDay 用 1~7 表示周一~周日，而 offset 是相对周日的位移（周日 = 0）。
    weekStartDayOffset: weekStartDay ? weekStartDay % 7 : generalSetting.weekStartDayOffset,
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
        <div className="flex items-center gap-1">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("markdown.calendar-block.filter")}
                className="h-6 w-6 p-0 rounded-lg border border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                <FilterIcon className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {dotOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={visibleDots.has(option.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleDot(option.key)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            dayEvents={(eventsByDate[day.date] ?? []).filter((name) => visibleDots.has(name))}
            events={events}
            showTaskDot={showTaskDot && visibleDots.has(TASKS_DOT_KEY)}
            onClick={day.isCurrentMonth ? onSelectDate : undefined}
          />
        ))}
      </div>
    </div>
  );
};
