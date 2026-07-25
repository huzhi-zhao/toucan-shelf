import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useTodayDate } from "@/components/ActivityCalendar/hooks";
import { useTranslate } from "@/utils/i18n";
import { useBlockSource } from "./BlockSourceContext";
import { CalendarDayDetail } from "./calendar/CalendarDayDetail";
import { CalendarMonthGrid } from "./calendar/CalendarMonthGrid";
import { CalendarUngroupedSection } from "./calendar/CalendarUngroupedSection";
import { defaultVisibleMonth, type VisibleMonth } from "./calendar/defaultVisibleMonth";
import { type CalendarItem, parseCalendarBlock } from "./calendar/parseCalendarBlock";
import { setCalendarItemStatus, toggleCalendarEvent, upsertCalendarItem } from "./calendar/upsertCalendarItem";
import { extractCodeContent } from "./utils";

interface CalendarBlockProps {
  children?: React.ReactNode;
  className?: string;
}

export const CalendarBlock = ({ children }: CalendarBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const parsed = useMemo(() => parseCalendarBlock(codeContent), [codeContent]);
  const { events, groups, allowMaxUpdateDays, showTaskDot } = parsed;

  const datedGroups = useMemo(() => groups.filter((g) => g.date), [groups]);
  const ungroupedItems = (groups.find((g) => !g.date)?.items ?? []).filter((i) => !i.isEvent);

  const today = useTodayDate();
  const [visibleMonth, setVisibleMonth] = useState<VisibleMonth>(() => defaultVisibleMonth());
  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => today);

  const blockSource = useBlockSource();
  const readonly = blockSource?.readonly ?? true;

  // allowMaxUpdateDays: N 时只允许改动最近 N 天（含今天）及未来的日期，
  // 避免误点历史格子导致旧记录被改写。
  const isDateEditable = (date: string) => {
    if (!allowMaxUpdateDays || allowMaxUpdateDays <= 0) return true;
    const daysAgo = dayjs(today).diff(dayjs(date), "day");
    return daysAgo < allowMaxUpdateDays;
  };

  const handleAddItems = (date: string, rawInput: string) => {
    if (!blockSource || !isDateEditable(date)) return;
    blockSource.save(upsertCalendarItem(blockSource.source, date, rawInput));
  };

  const handleSetItemStatus = (date: string, itemIndex: number, marker: string) => {
    if (!blockSource || !isDateEditable(date)) return;
    blockSource.save(setCalendarItemStatus(blockSource.source, date, itemIndex, marker));
  };

  const handleToggleEvent = (date: string, name: string, occurred: boolean) => {
    if (!blockSource || !isDateEditable(date)) return;
    blockSource.save(toggleCalendarEvent(blockSource.source, date, name, occurred, events));
  };

  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of datedGroups) {
      counts[group.date!] = group.items.length;
    }
    return counts;
  }, [datedGroups]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    for (const group of datedGroups) {
      map[group.date!] = group.items;
    }
    return map;
  }, [datedGroups]);

  // 每个日期发生的 event 名称（去重、按预定义顺序），供日历格子底部打点用。
  const eventsByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const group of datedGroups) {
      const names: string[] = [];
      for (const item of group.items) {
        if (item.isEvent && events.includes(item.text) && !names.includes(item.text)) {
          names.push(item.text);
        }
      }
      if (names.length > 0) {
        names.sort((a, b) => events.indexOf(a) - events.indexOf(b));
        map[group.date!] = names;
      }
    }
    return map;
  }, [datedGroups, events]);

  if (groups.length === 0) {
    return <div className="text-sm text-muted-foreground px-1 py-2">{t("markdown.calendar-block.empty")}</div>;
  }

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
  };

  const handleMonthChange = (month: VisibleMonth) => {
    setVisibleMonth(month);
    if (selectedDate) {
      const stillInMonth = selectedDate.startsWith(`${month.year}-${String(month.month + 1).padStart(2, "0")}`);
      if (!stillInMonth) {
        setSelectedDate(undefined);
      }
    }
  };

  const effectiveDate = selectedDate ?? today;
  const selectedGroup = datedGroups.find((g) => g.date === effectiveDate);

  return (
    <div className="flex flex-col gap-3 not-prose">
      {ungroupedItems.length > 0 && <CalendarUngroupedSection items={ungroupedItems} />}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        <div className="md:basis-[60%] md:grow-[6] md:shrink-0 md:border-r md:border-border/40 md:pr-4">
          <CalendarMonthGrid
            month={visibleMonth}
            onMonthChange={handleMonthChange}
            itemCounts={itemCounts}
            itemsByDate={itemsByDate}
            eventsByDate={eventsByDate}
            events={events}
            showTaskDot={showTaskDot ?? false}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />
        </div>
        <div className="md:basis-[40%] md:grow-[4] md:shrink-0 md:pl-4">
          <CalendarDayDetail
            group={selectedGroup}
            selectedDate={effectiveDate}
            readonly={readonly || !isDateEditable(effectiveDate)}
            events={events}
            onAddItems={blockSource ? handleAddItems : undefined}
            onSetItemStatus={blockSource ? handleSetItemStatus : undefined}
            onToggleEvent={blockSource ? handleToggleEvent : undefined}
          />
        </div>
      </div>
    </div>
  );
};
