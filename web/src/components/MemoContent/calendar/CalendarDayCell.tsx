import type { CalendarDayCell as DayCellData } from "@/components/ActivityCalendar/types";
import { cn } from "@/lib/utils";
import { getEventColorByName } from "./eventColors";
import type { CalendarItem } from "./parseCalendarBlock";

interface CalendarDayCellProps {
  day: DayCellData;
  items: CalendarItem[];
  dayEvents: string[]; // 当天发生的 event 名称（已去重、按预定义顺序）
  events: string[]; // 预定义 event 列表，用于取色
  showTaskDot: boolean; // 移动端是否在日期右侧画"当天有任务"的蓝点
  onClick?: (date: string) => void;
}

const MAX_PREVIEW_ITEMS = 2;

export const CalendarDayCell = ({ day, items, dayEvents, events, showTaskDot, onClick }: CalendarDayCellProps) => {
  const taskItems = items.filter((item) => !item.isEvent);
  const hasTasks = taskItems.length > 0;
  const previewItems = taskItems.slice(0, MAX_PREVIEW_ITEMS);
  const hasEvents = dayEvents.length > 0;
  // 上/下月的格子照常画日期与打点，但整体置灰、不可点击，只作为上下文参考。
  const isOutside = !day.isCurrentMonth;
  const isInteractive = Boolean(onClick) && !isOutside;

  const className = cn(
    "relative flex aspect-square flex-col justify-between gap-0.5 overflow-hidden rounded-xl border border-border/30 bg-muted/10 p-1 transition-colors",
    "md:justify-start md:gap-1 md:p-1.5",
    isOutside && "border-border/15 bg-transparent opacity-50",
    isInteractive ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
    day.isToday && !isOutside && "ring-2 ring-inset ring-primary",
  );

  const content = (
    <>
      {day.isSelected && !isOutside && (
        <span
          className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[14px] border-t-[14px] border-l-transparent border-t-primary"
          aria-hidden="true"
        />
      )}
      {/* 日期数字一行，右侧对齐当天有任务的方点（仅 showTaskDot: true 时显示） */}
      <div className="flex w-full items-center justify-between gap-1">
        <span className={cn("shrink-0 text-xs font-medium md:text-sm", isOutside ? "text-muted-foreground/50" : "text-foreground")}>
          {day.label}
        </span>
        {showTaskDot && hasTasks && <span className="h-1 w-1 shrink-0 bg-primary/70 md:hidden" aria-hidden="true" />}
      </div>
      {/* 移动端：events 圆点固定分布在 5 等分格中，按 events 定义顺序对号入座 */}
      {hasEvents && (
        <div className="mt-auto grid grid-cols-5 items-center md:hidden" aria-hidden="true">
          {events.slice(0, 5).map((name) => (
            <div key={name} className="flex items-center justify-center">
              {dayEvents.includes(name) && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getEventColorByName(name, events) }} />
              )}
            </div>
          ))}
        </div>
      )}
      {hasTasks && (
        <div className="hidden md:flex md:flex-col md:gap-0.5 md:overflow-hidden md:text-left">
          {previewItems.map((item, index) => (
            <span
              key={index}
              className={cn("truncate text-[10px] leading-tight", isOutside ? "text-muted-foreground/50" : "text-muted-foreground")}
            >
              {item.text}
            </span>
          ))}
        </div>
      )}
      {/* events 圆点固定分布在 5 等分格中，按 events 定义顺序对号入座，某天未发生的事件留空不占用其他格子 */}
      {hasEvents && (
        <div className="hidden grid-cols-5 items-center md:mt-auto md:grid" aria-hidden="true">
          {events.slice(0, 5).map((name) => (
            <div key={name} className="flex items-center justify-center">
              {dayEvents.includes(name) && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: getEventColorByName(name, events) }}
                  title={isOutside ? undefined : name}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (isOutside) {
    return (
      <div className={className} aria-hidden="true">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(day.date)}
      aria-current={day.isToday ? "date" : undefined}
      aria-pressed={day.isSelected}
      className={className}
    >
      {content}
    </button>
  );
};
