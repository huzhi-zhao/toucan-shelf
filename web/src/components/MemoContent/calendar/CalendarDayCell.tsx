import type { CalendarDayCell as DayCellData } from "@/components/ActivityCalendar/types";
import { cn } from "@/lib/utils";
import { getEventColorByName } from "./eventColors";
import type { CalendarItem } from "./parseCalendarBlock";

interface CalendarDayCellProps {
  day: DayCellData;
  items: CalendarItem[];
  dayEvents: string[]; // 当天发生的 event 名称（已去重、按预定义顺序）
  events: string[]; // 预定义 event 列表，用于取色
  showTaskDot: boolean; // 是否在日期右侧画"当天有任务"的蓝点
  slots?: string[]; // 当天的 5 个圆点位依次是哪些 event；省略时取 events 前 5 个
  colorOf?: (name: string) => string; // event 的颜色；省略时按它在 events 里的下标取色
  iconOf?: (name: string) => string; // 给出时不画圆点，改画当天打了卡的 event 的图标，每行三等分、各自居中，从左往右依次排
  onClick?: (date: string) => void;
}

const MAX_PREVIEW_ITEMS = 2;

export const CalendarDayCell = ({ day, items, dayEvents, events, showTaskDot, slots, colorOf, iconOf, onClick }: CalendarDayCellProps) => {
  const slotNames = (slots ?? events).slice(0, 5);
  const color = (name: string) => (colorOf ? colorOf(name) : getEventColorByName(name, events));
  const taskItems = items.filter((item) => !item.isEvent);
  const hasTasks = taskItems.length > 0;
  const previewItems = taskItems.slice(0, MAX_PREVIEW_ITEMS);
  const hasEvents = dayEvents.length > 0;
  // 悬停圆点时连同评论一起提示，如 "💪运动：跑步10分钟"。
  const eventTitle = (name: string) => {
    const comment = items.find((item) => item.isEvent && !item.hidden && item.text === name)?.comment;
    return comment ? `${name}：${comment}` : name;
  };
  // 上/下月的格子照常画日期与打点，但整体置灰、不可点击，只作为上下文参考。
  const isOutside = !day.isCurrentMonth;
  const isInteractive = Boolean(onClick) && !isOutside;

  const className = cn(
    "relative flex aspect-square flex-col justify-between gap-0.5 overflow-hidden rounded-xl border border-border/30 bg-muted/10 p-1 transition-colors",
    "md:justify-start md:gap-1 md:p-1.5",
    // 宽屏下高度正好放下：日期一行、两行文字预览、一行图标（2 + 12 + 16 + 2 + 27 + 2 + 13），不随宽度拉成正方形留白
    iconOf && "md:aspect-auto md:h-[74px] md:gap-0.5",
    isOutside && "border-border/15 bg-transparent opacity-50",
    isInteractive ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
    // 选中态用实心外框强调；今天的框减半淡化，两者同时出现时也能区分开
    day.isSelected && !isOutside && "ring-2 ring-inset ring-primary",
    day.isToday && !day.isSelected && !isOutside && "ring-2 ring-inset ring-primary/50",
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
        <span
          className={cn(
            "shrink-0 text-xs font-medium md:text-sm",
            iconOf && "md:leading-4",
            isOutside ? "text-muted-foreground/50" : "text-foreground",
          )}
        >
          {day.label}
        </span>
        {showTaskDot && hasTasks && <span className="h-1.5 w-1.5 shrink-0 bg-primary/70" aria-hidden="true" />}
      </div>
      {/* 移动端：events 圆点固定分布在 5 等分格中，按 events 定义顺序对号入座 */}
      {hasEvents && !iconOf && (
        <div className="mt-auto grid grid-cols-5 items-center md:hidden" aria-hidden="true">
          {slotNames.map((name) => (
            <div key={name} className="flex items-center justify-center">
              {dayEvents.includes(name) && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color(name) }} />}
            </div>
          ))}
        </div>
      )}
      {hasTasks && (
        <div className="hidden md:flex md:min-h-0 md:flex-col md:gap-0.5 md:overflow-hidden md:text-left">
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
      {/* 图标本身认得出是哪个 event，不必靠位置：只排打了卡的，不留空位；抵消格子内边距，整格宽三等分、各自居中；总在最底下，放在文字预览之后 */}
      {hasEvents && iconOf && (
        <div className="-mx-1 mt-auto grid shrink-0 grid-cols-3 text-[11px] leading-[13px] md:-mx-1.5" aria-hidden="true">
          {dayEvents.map((name) => (
            <span key={name} className="text-center" title={isOutside ? undefined : eventTitle(name)}>
              {iconOf(name)}
            </span>
          ))}
        </div>
      )}
      {/* events 圆点固定分布在 5 等分格中，按 events 定义顺序对号入座，某天未发生的事件留空不占用其他格子 */}
      {hasEvents && !iconOf && (
        <div className="hidden grid-cols-5 items-center md:mt-auto md:grid" aria-hidden="true">
          {slotNames.map((name) => (
            <div key={name} className="flex items-center justify-center">
              {dayEvents.includes(name) && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color(name) }}
                  title={isOutside ? undefined : eventTitle(name)}
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
