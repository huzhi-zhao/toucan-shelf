import { PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { resolveTaskStatus } from "@/utils/task-status";
import { TaskStatusCheckbox } from "../TaskStatusCheckbox";
import { getEventColorByName } from "./eventColors";
import type { CalendarGroup } from "./parseCalendarBlock";

const taskTextClass = (marker: string) => {
  const status = resolveTaskStatus(marker);
  return cn(status.strikethrough && "line-through", status.muted && "text-muted-foreground");
};

interface CalendarDayDetailProps {
  group?: CalendarGroup;
  selectedDate?: string;
  readonly?: boolean;
  events: string[]; // 预定义 event 列表
  onAddItems?: (date: string, rawInput: string) => void;
  onSetItemStatus?: (date: string, itemIndex: number, marker: string) => void;
  onToggleEvent?: (date: string, name: string, occurred: boolean) => void;
  onSetEventComment?: (date: string, name: string, comment: string) => void;
}

export const CalendarDayDetail = ({
  group,
  selectedDate,
  readonly,
  events,
  onAddItems,
  onSetItemStatus,
  onToggleEvent,
  onSetEventComment,
}: CalendarDayDetailProps) => {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  // 下方输入框的写入目标：undefined 时添加待办；为 event 名称时编辑该 event 的评论。
  const [commentTarget, setCommentTarget] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!selectedDate) {
    return null;
  }

  // 拆分：event 打点 vs. 普通任务。任务保留其在 group.items 中的原始下标，
  // 以便与 onToggleItem 的索引口径（parseCalendarBlock 的 items 顺序）对齐。
  const visibleEventItems = (group?.items ?? []).filter((i) => i.isEvent && !i.hidden);
  const occurredEvents = new Set(visibleEventItems.map((i) => i.text));
  const eventComments = new Map(visibleEventItems.filter((i) => i.comment).map((i) => [i.text, i.comment!]));
  // 取消勾选时保留下来的评论，重新勾选会恢复，所以选中目标时也要能预填。
  const keptComment = (name: string) =>
    eventComments.get(name) ?? (group?.items ?? []).find((i) => i.isEvent && i.hidden && i.text === name)?.comment;
  const taskItems = (group?.items ?? []).map((item, index) => ({ item, index })).filter(({ item }) => !item.isEvent);
  const displayEvents = events.filter((name) => occurredEvents.has(name));

  const resetCommentTarget = () => {
    setCommentTarget(undefined);
    setDraft("");
  };

  // 切到某个 event 的评论：有已存评论就预填，没有则保留已输入的文字。
  const selectCommentTarget = (name: string) => {
    if (!onSetEventComment) return;
    setCommentTarget(name);
    const comment = keptComment(name);
    if (comment !== undefined) setDraft(comment);
    textareaRef.current?.focus();
  };

  const handleToggleEvent = (name: string, occurred: boolean) => {
    onToggleEvent?.(selectedDate, name, occurred);
    if (occurred) {
      selectCommentTarget(name);
    } else if (name === commentTarget) {
      resetCommentTarget();
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // 评论草稿不跨次保留，免得下次打开时被当成待办提交。
    if (!next && commentTarget) resetCommentTarget();
  };

  const handleSave = () => {
    if (commentTarget) {
      if (draft.trim() !== (eventComments.get(commentTarget) ?? "")) {
        onSetEventComment?.(selectedDate, commentTarget, draft);
      }
      handleOpenChange(false);
      return;
    }
    if (!draft.trim()) {
      setOpen(false);
      return;
    }
    onAddItems?.(selectedDate, draft);
    setDraft("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      handleSave();
      return;
    }
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const { selectionStart, selectionEnd, value } = el;
      const selected = value.slice(selectionStart, selectionEnd);
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);

      // Toggle off if the selection is already wrapped in **bold**.
      if (before.endsWith("**") && after.startsWith("**")) {
        const newValue = before.slice(0, -2) + selected + after.slice(2);
        setDraft(newValue);
        requestAnimationFrame(() => el.setSelectionRange(selectionStart - 2, selectionEnd - 2));
        return;
      }

      const newValue = `${before}**${selected}**${after}`;
      setDraft(newValue);
      const cursor = selected ? selectionEnd + 4 : selectionStart + 2;
      requestAnimationFrame(() => el.setSelectionRange(cursor, cursor));
    }
  };

  const canEdit = !readonly && Boolean(onAddItems);
  const canToggleEvents = !readonly && Boolean(onToggleEvent) && events.length > 0;

  const addButton = canEdit && (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6 mr-1 text-muted-foreground hover:text-foreground">
          <PlusIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex flex-col gap-2">
          {canToggleEvents && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("markdown.calendar-block.events")}
                </span>
                {events.map((name) => {
                  const occurred = occurredEvents.has(name);
                  return (
                    <div
                      key={name}
                      className={cn("flex items-center gap-2 rounded-md px-1 -mx-1 text-sm", name === commentTarget && "bg-muted")}
                    >
                      <Checkbox
                        checked={occurred}
                        onCheckedChange={(checked) => handleToggleEvent(name, checked === true)}
                        className="shrink-0"
                        aria-label={name}
                      />
                      {/* 点名称：未勾选时等同勾选；已勾选时切到给它写评论 */}
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-left"
                        onClick={() => (occurred ? selectCommentTarget(name) : handleToggleEvent(name, true))}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getEventColorByName(name, events) }}
                          aria-hidden="true"
                        />
                        <span className="shrink-0">{name}</span>
                        {occurred && eventComments.has(name) && (
                          <span className="truncate text-xs text-muted-foreground">{eventComments.get(name)}</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border/40" />
            </>
          )}
          {commentTarget && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="uppercase tracking-wide">{t("markdown.calendar-block.comment")}</span>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: getEventColorByName(commentTarget, events) }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-foreground">{commentTarget}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 text-muted-foreground hover:text-foreground"
                onClick={resetCommentTarget}
                aria-label={t("markdown.calendar-block.add-tasks-instead")}
                title={t("markdown.calendar-block.add-tasks-instead")}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            autoFocus
            placeholder={
              commentTarget ? t("markdown.calendar-block.comment-placeholder", { name: commentTarget }) : "Buy milk\nRead a book"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className="text-sm"
            rows={4}
          />
          <Button size="sm" onClick={handleSave}>
            {t("common.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const hasEvents = displayEvents.length > 0;
  const hasTasks = taskItems.length > 0;

  if (!hasEvents && !hasTasks) {
    return (
      <div className="flex items-center justify-between gap-2 px-1 py-2">
        <span className="text-sm text-muted-foreground">{t("markdown.calendar-block.no-records", { date: selectedDate })}</span>
        {addButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-1 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{selectedDate}</span>
        {addButton}
      </div>

      {hasEvents && (
        <ul className="flex flex-col gap-1">
          {displayEvents.map((name) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: getEventColorByName(name, events) }}
                aria-hidden="true"
              />
              <span className="shrink-0">{name}</span>
              {eventComments.has(name) && <span className="min-w-0 text-muted-foreground">{eventComments.get(name)}</span>}
            </li>
          ))}
        </ul>
      )}

      {hasEvents && hasTasks && <div className="border-t border-border/40" />}

      {hasTasks && (
        <ul className="flex flex-col gap-1">
          {taskItems.map(({ item, index }) => (
            <li key={index} className="flex items-center gap-2 text-sm">
              {item.marker !== undefined ? (
                <>
                  <TaskStatusCheckbox
                    marker={item.marker}
                    readonly={readonly || !onSetItemStatus}
                    onSelect={(marker) => onSetItemStatus?.(selectedDate, index, marker)}
                  />
                  <span className={cn(taskTextClass(item.marker))}>{item.text}</span>
                </>
              ) : (
                <span className="pl-6">{item.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
