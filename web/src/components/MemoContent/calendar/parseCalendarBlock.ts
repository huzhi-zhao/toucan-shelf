import { isTaskStatusMarker, resolveTaskStatus } from "@/utils/task-status";

export interface CalendarItem {
  text: string;
  checked?: boolean; // undefined = 无 checkbox 的纯文本条目
  marker?: string; // 扩展状态标记（" " | "x" | "/" | ...），undefined = 纯文本条目
  isEvent?: boolean; // true = 该条目是一次 event 打点（text 为 event 名称）
}

export interface CalendarGroup {
  date?: string; // YYYY-MM-DD；undefined 表示"未分组"区块
  items: CalendarItem[];
}

export interface ParsedCalendar {
  events: string[]; // 预定义的 event 名称列表，顺序即颜色下标
  groups: CalendarGroup[];
  allowMaxUpdateDays?: number; // 仅允许编辑最近 N 天内的日期，避免误点历史数据
  weekStartDay?: number; // 一周从星期几开始：1=周一 …… 6=周六、7=周日；省略时用实例设置
  showTaskDot?: boolean; // true 时移动端日历格子才画"当天有任务"的蓝点
}

const EVENTS_LINE_RE = /^@?events:\s*(.*)$/i;
const ALLOW_MAX_UPDATE_DAYS_RE = /^@?allowMaxUpdateDays:\s*(\d+)\s*$/i;
const WEEK_START_DAY_RE = /^@?weekStartDay:\s*([1-7])\s*$/i;
const SHOW_TASK_DOT_RE = /^@?showTaskDot:\s*(true|false)\s*$/i;
const DATE_LINE_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s*$/;
const EVENT_ITEM_RE = /^-\s+@(.+)$/;
// 方括号内接受任意扩展状态字符；未知字符按纯文本处理。
const ITEM_LINE_RE = /^-\s+(?:\[(.)\]\s+)?(.+)$/;

function parseEventsLine(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 把 `- @xxx` 中的引用解析为 event 名称。
 * 纯数字为 1 基下标（指向 events 列表），这样重命名 event 时历史数据无需改动；
 * 其他情况按名称原样返回（兼容旧数据）。
 */
export function resolveEventRef(ref: string, events: string[]): string {
  if (/^\d+$/.test(ref)) {
    return events[Number(ref) - 1] ?? ref;
  }
  return ref;
}

/** 写入时使用的引用形式：已预定义的 event 用 1 基下标，否则退回名称。 */
export function eventRefFor(name: string, events: string[]): string {
  const index = events.indexOf(name);
  return index === -1 ? name : String(index + 1);
}

export function parseCalendarBlock(raw: string): ParsedCalendar {
  const groups: CalendarGroup[] = [];
  const events: string[] = [];
  let allowMaxUpdateDays: number | undefined;
  let weekStartDay: number | undefined;
  let showTaskDot: boolean | undefined;
  let ungrouped: CalendarGroup | undefined;
  let current: CalendarGroup | undefined;
  // event 引用可能是下标，而 events: 行不保证出现在数据之前，故先记下待解析的条目。
  const pendingEventItems: { item: CalendarItem; ref: string }[] = [];

  for (const line of raw.split("\n")) {
    const daysMatch = ALLOW_MAX_UPDATE_DAYS_RE.exec(line.trim());
    if (daysMatch) {
      allowMaxUpdateDays = Number(daysMatch[1]);
      continue;
    }

    const weekStartMatch = WEEK_START_DAY_RE.exec(line.trim());
    if (weekStartMatch) {
      weekStartDay = Number(weekStartMatch[1]);
      continue;
    }

    const dotMatch = SHOW_TASK_DOT_RE.exec(line.trim());
    if (dotMatch) {
      showTaskDot = dotMatch[1].toLowerCase() === "true";
      continue;
    }

    const eventsMatch = EVENTS_LINE_RE.exec(line.trim());
    if (eventsMatch) {
      for (const name of parseEventsLine(eventsMatch[1])) {
        if (!events.includes(name)) events.push(name);
      }
      continue;
    }

    const dateMatch = DATE_LINE_RE.exec(line);
    if (dateMatch) {
      current = { date: dateMatch[1], items: [] };
      groups.push(current);
      continue;
    }

    const eventMatch = EVENT_ITEM_RE.exec(line);
    if (eventMatch) {
      const ref = eventMatch[1].trim();
      const item: CalendarItem = { text: ref, isEvent: true };
      pendingEventItems.push({ item, ref });
      if (current) {
        current.items.push(item);
      } else {
        if (!ungrouped) ungrouped = { date: undefined, items: [] };
        ungrouped.items.push(item);
      }
      continue;
    }

    const itemMatch = ITEM_LINE_RE.exec(line);
    if (itemMatch) {
      const rawMarker = itemMatch[1];
      const isTask = rawMarker !== undefined && isTaskStatusMarker(rawMarker);
      const marker = isTask ? resolveTaskStatus(rawMarker).marker : undefined;
      const item: CalendarItem = {
        // 未识别的标记（如 `- [z] foo`）保留原始文本，不当作任务。
        text: rawMarker !== undefined && !isTask ? `[${rawMarker}] ${itemMatch[2]}` : itemMatch[2],
        checked: marker === undefined ? undefined : marker === "x",
        marker,
      };
      if (current) {
        current.items.push(item);
      } else {
        if (!ungrouped) {
          ungrouped = { date: undefined, items: [] };
        }
        ungrouped.items.push(item);
      }
    }
  }

  for (const { item, ref } of pendingEventItems) {
    item.text = resolveEventRef(ref, events);
  }

  if (ungrouped) {
    groups.unshift(ungrouped);
  }

  return { events, groups, allowMaxUpdateDays, weekStartDay, showTaskDot };
}
