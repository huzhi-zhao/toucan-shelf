// String-level edits to a ```calendar fenced code block within a memo's raw
// markdown content. Operates on lines directly rather than an AST, since
// fenced code block contents are opaque to markdown ASTs.

import { isTaskStatusMarker, resolveTaskStatus } from "@/utils/task-status";
import { eventRefFor, parseEventBody } from "./parseCalendarBlock";

const FENCE_START_RE = /^```calendar\s*$/;
const FENCE_END_RE = /^```\s*$/;
const DATE_LINE_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s*$/;
const EVENT_ITEM_RE = /^-\s+(~?)@(.+)$/;
const ITEM_LINE_RE = /^-\s+(?:\[(.)\]\s+)?(.+)$/;
// Accepts "- [ ] text", "-[] text", "- [x] text", or plain "text" input lines.
const INPUT_LINE_RE = /^-?\s*\[(.?)\]\s*(.+)$/;

interface CalendarFenceLocation {
  lines: string[];
  fenceStart: number;
  fenceEnd: number;
  blockLines: string[];
}

function locateCalendarFence(content: string): CalendarFenceLocation | undefined {
  const lines = content.split("\n");

  const fenceStart = lines.findIndex((line) => FENCE_START_RE.test(line));
  if (fenceStart === -1) {
    return undefined;
  }

  let fenceEnd = -1;
  for (let i = fenceStart + 1; i < lines.length; i++) {
    if (FENCE_END_RE.test(lines[i])) {
      fenceEnd = i;
      break;
    }
  }
  if (fenceEnd === -1) {
    return undefined;
  }

  return { lines, fenceStart, fenceEnd, blockLines: lines.slice(fenceStart + 1, fenceEnd) };
}

// 配置行形如 `events: a, b` / `allowMaxUpdateDays: 7`（可带 @ 前缀），
// 与条目行（以 `-` 开头）不会混淆。
const CONFIG_LINE_RE = /^@?[A-Za-z][A-Za-z0-9_]*:\s*.*$/;

// 分组内条目的排序权重：重要 → 未开始 → 已完成 → 其他状态（进行中 / 排期 /
// 延后 / 疑问，含无 checkbox 的纯文本）→ 作废。
const STATUS_RANK: Record<string, number> = { "!": 0, " ": 1, x: 2, "-": 4 };
const OTHER_RANK = 3;

function itemRank(line: string): number {
  const match = ITEM_LINE_RE.exec(line.trim());
  const raw = match?.[1];
  if (raw === undefined || !isTaskStatusMarker(raw)) {
    return OTHER_RANK;
  }
  return STATUS_RANK[resolveTaskStatus(raw).marker] ?? OTHER_RANK;
}

/** event 打点行始终排在任务之前。 */
function sortGroupLines(lines: string[]): string[] {
  const events = lines.filter((line) => EVENT_ITEM_RE.test(line.trim()));
  const items = lines.filter((line) => !EVENT_ITEM_RE.test(line.trim()));

  // 稳定排序：同权重条目保持原有先后。
  const ranked = items.map((line, index) => ({ line, index, rank: itemRank(line) }));
  ranked.sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank));

  return [...events, ...ranked.map(({ line }) => line)];
}

/**
 * 规范化 calendar 块：所有配置项提到最顶部，日期分组按日期倒序排列，
 * 分组内条目按状态排序。
 * 未分组条目（第一个日期行之前的条目）保持在配置之后、日期分组之前。
 */
export function normalizeCalendarBlock(blockLines: string[]): string[] {
  const configLines: string[] = [];
  const ungrouped: string[] = [];
  const groups: { date: string; lines: string[] }[] = [];
  let current: { date: string; lines: string[] } | undefined;

  for (const line of blockLines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // 空行由输出统一重建

    if (CONFIG_LINE_RE.test(trimmed)) {
      configLines.push(trimmed);
      continue;
    }

    const dateMatch = DATE_LINE_RE.exec(line);
    if (dateMatch) {
      current = { date: dateMatch[1], lines: [] };
      groups.push(current);
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      ungrouped.push(line);
    }
  }

  // 稳定排序：同日期分组保持原相对顺序。
  const sorted = groups.map((group, index) => ({ group, index }));
  sorted.sort((a, b) => (a.group.date === b.group.date ? a.index - b.index : a.group.date < b.group.date ? 1 : -1));

  const out: string[] = [...configLines];
  if (ungrouped.length > 0) {
    if (out.length > 0) out.push("");
    out.push(...ungrouped);
  }
  for (const { group } of sorted) {
    if (out.length > 0) out.push("");
    out.push(`- ${group.date}`, ...sortGroupLines(group.lines));
  }
  return out;
}

function rebuildContent(location: CalendarFenceLocation, newBlockLines: string[]): string {
  const { lines, fenceStart, fenceEnd } = location;
  return [...lines.slice(0, fenceStart + 1), ...normalizeCalendarBlock(newBlockLines), ...lines.slice(fenceEnd)].join("\n");
}

function formatItemLine(rawLine: string): string | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed) return undefined;

  const match = INPUT_LINE_RE.exec(trimmed);
  if (match) {
    const marker = isTaskStatusMarker(match[1]) ? resolveTaskStatus(match[1]).marker : " ";
    const text = match[2].trim();
    if (!text) return undefined;
    return `- [${marker}] ${text}`;
  }

  return `- [ ] ${trimmed}`;
}

/**
 * Inserts new task lines for `date` at the top of that date's group inside
 * the first ```calendar fenced code block found in `content`. If the date
 * has no existing group, a new one is created at the top of the block.
 *
 * Returns the original content unchanged if no calendar block, or no valid
 * input lines, are found.
 */
export function upsertCalendarItem(content: string, date: string, rawInput: string): string {
  const newItemLines = rawInput
    .split("\n")
    .map(formatItemLine)
    .filter((line): line is string => Boolean(line));

  if (newItemLines.length === 0) {
    return content;
  }

  const location = locateCalendarFence(content);
  if (!location) {
    return content;
  }
  const { blockLines } = location;

  let dateLineIndex = -1;
  for (let i = 0; i < blockLines.length; i++) {
    const match = DATE_LINE_RE.exec(blockLines[i]);
    if (match && match[1] === date) {
      dateLineIndex = i;
      break;
    }
  }

  let newBlockLines: string[];
  if (dateLineIndex !== -1) {
    newBlockLines = [...blockLines.slice(0, dateLineIndex + 1), ...newItemLines, ...blockLines.slice(dateLineIndex + 1)];
  } else {
    // 追加到末尾，避免落在未分组条目之前把它们吞进新分组；normalize 会重新排序。
    newBlockLines = [...blockLines, "", `- ${date}`, ...newItemLines];
  }

  return rebuildContent(location, newBlockLines);
}

interface EventLineMatch {
  index: number;
  hidden: boolean;
  comment?: string;
}

interface DateGroupBounds {
  dateLineIndex: number; // -1 表示该日期还没有分组
  groupEnd: number; // 分组结束边界（下一个日期行，或块末尾）
}

function findDateGroup(blockLines: string[], date: string): DateGroupBounds {
  const dateLineIndex = blockLines.findIndex((line) => DATE_LINE_RE.exec(line)?.[1] === date);
  let groupEnd = blockLines.length;
  if (dateLineIndex !== -1) {
    for (let i = dateLineIndex + 1; i < blockLines.length; i++) {
      if (DATE_LINE_RE.test(blockLines[i])) {
        groupEnd = i;
        break;
      }
    }
  }
  return { dateLineIndex, groupEnd };
}

/** 在分组内查找指定 event 的行；`hidden` 区分正常打点与 `~@` 保留行。下标与旧名称写法都能匹配。 */
function findEventLine(blockLines: string[], bounds: DateGroupBounds, name: string, events: string[], hidden: boolean) {
  if (bounds.dateLineIndex === -1) return undefined;
  for (let i = bounds.dateLineIndex + 1; i < bounds.groupEnd; i++) {
    const match = EVENT_ITEM_RE.exec(blockLines[i]);
    if (!match || (match[1] === "~") !== hidden) continue;
    const parsed = parseEventBody(match[2], events);
    if (parsed.name === name) {
      return { index: i, hidden, comment: parsed.comment } satisfies EventLineMatch;
    }
  }
  return undefined;
}

// 评论写在一行里，换行等空白折叠成单个空格。
function normalizeComment(comment: string | undefined): string | undefined {
  const text = comment?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

// 写入用 1 基下标（`- @1`），这样重命名 event 时历史打点无需迁移。
function formatEventLine(name: string, events: string[], comment?: string, hidden = false): string {
  const ref = eventRefFor(name, events);
  return `- ${hidden ? "~" : ""}@${ref}${comment ? ` ${comment}` : ""}`;
}

function insertIntoGroup(blockLines: string[], bounds: DateGroupBounds, date: string, line: string): string[] {
  if (bounds.dateLineIndex !== -1) {
    return [...blockLines.slice(0, bounds.dateLineIndex + 1), line, ...blockLines.slice(bounds.dateLineIndex + 1)];
  }
  return [...blockLines, "", `- ${date}`, line];
}

function replaceLine(blockLines: string[], index: number, line?: string): string[] {
  return [...blockLines.slice(0, index), ...(line === undefined ? [] : [line]), ...blockLines.slice(index + 1)];
}

/**
 * 在 `date` 的分组内添加或移除一次 event 打点（`- @name` 行）。
 * `occurred` 为 true 时确保存在该 event 行（若有 `~@` 保留行则恢复它，评论随之恢复）；
 * false 时移除它——但带评论的行不删，改成 `~@` 保留行隐藏起来。
 * 若该日期无分组，会在块末尾新建一个分组（normalize 会重新排序）。
 *
 * 未找到 calendar 块时原样返回。
 */
export function toggleCalendarEvent(content: string, date: string, name: string, occurred: boolean, events: string[] = []): string {
  const location = locateCalendarFence(content);
  if (!location) {
    return content;
  }
  const { blockLines } = location;
  const bounds = findDateGroup(blockLines, date);
  const visible = findEventLine(blockLines, bounds, name, events, false);

  if (occurred) {
    if (visible) return content; // 已存在，无需变更
    const kept = findEventLine(blockLines, bounds, name, events, true);
    if (kept) {
      return rebuildContent(location, replaceLine(blockLines, kept.index, formatEventLine(name, events, kept.comment)));
    }
    return rebuildContent(location, insertIntoGroup(blockLines, bounds, date, formatEventLine(name, events)));
  }

  // occurred === false
  if (!visible) return content;
  const next = visible.comment ? formatEventLine(name, events, visible.comment, true) : undefined;
  return rebuildContent(location, replaceLine(blockLines, visible.index, next));
}

/**
 * 设置 `date` 当天某个 event 的评论（整条替换；空字符串清除评论）。
 * 该 event 当天未发生时会一并打点：有 `~@` 保留行就恢复它，否则新增一行。
 *
 * 未找到 calendar 块时原样返回。
 */
export function setCalendarEventComment(content: string, date: string, name: string, comment: string, events: string[] = []): string {
  const location = locateCalendarFence(content);
  if (!location) {
    return content;
  }
  const { blockLines } = location;
  const bounds = findDateGroup(blockLines, date);
  const line = formatEventLine(name, events, normalizeComment(comment));
  const existing = findEventLine(blockLines, bounds, name, events, false) ?? findEventLine(blockLines, bounds, name, events, true);

  if (existing) {
    return rebuildContent(location, replaceLine(blockLines, existing.index, line));
  }
  return rebuildContent(location, insertIntoGroup(blockLines, bounds, date, line));
}

/**
 * Toggles the checkbox of the `itemIndex`-th item (0-based, in document order)
 * within `date`'s group inside the ```calendar fenced code block. Items
 * without a checkbox are skipped, matching parseCalendarBlock's item ordering.
 *
 * Returns the original content unchanged if the block, date group, or item
 * can't be found, or if the item has no checkbox to toggle.
 */
export function toggleCalendarItem(content: string, date: string, itemIndex: number, checked: boolean): string {
  return setCalendarItemStatus(content, date, itemIndex, checked ? "x" : " ");
}

/** As above, but writes any extended status marker (`[/]`, `[?]`, …). */
export function setCalendarItemStatus(content: string, date: string, itemIndex: number, marker: string): string {
  if (!isTaskStatusMarker(marker)) {
    return content;
  }
  const nextMarker = resolveTaskStatus(marker).marker;
  const location = locateCalendarFence(content);
  if (!location) {
    return content;
  }
  const { blockLines } = location;

  let dateLineIndex = -1;
  for (let i = 0; i < blockLines.length; i++) {
    const match = DATE_LINE_RE.exec(blockLines[i]);
    if (match && match[1] === date) {
      dateLineIndex = i;
      break;
    }
  }
  if (dateLineIndex === -1) {
    return content;
  }

  let groupEnd = blockLines.length;
  for (let i = dateLineIndex + 1; i < blockLines.length; i++) {
    if (DATE_LINE_RE.test(blockLines[i])) {
      groupEnd = i;
      break;
    }
  }

  // Count every item line (checkbox or not), matching parseCalendarBlock's
  // group.items ordering, so itemIndex lines up with the rendered list.
  let seen = 0;
  for (let i = dateLineIndex + 1; i < groupEnd; i++) {
    const match = ITEM_LINE_RE.exec(blockLines[i]);
    if (!match) continue;
    if (seen === itemIndex) {
      if (match[1] === undefined || !isTaskStatusMarker(match[1])) return content; // no checkbox on this line, nothing to set
      const newBlockLines = [...blockLines];
      newBlockLines[i] = blockLines[i].replace(ITEM_LINE_RE, (_full, _check, text) => `- [${nextMarker}] ${text}`);
      return rebuildContent(location, newBlockLines);
    }
    seen++;
  }

  return content;
}
