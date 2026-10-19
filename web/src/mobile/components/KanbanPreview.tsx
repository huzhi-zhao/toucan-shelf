import { Sheet } from "konsta/react";
import { CalendarIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildKanbanColumns,
  COLLAPSED_LIMIT,
  formatTaskValue,
  taskCustomEntries,
  UNGROUPED_KEY,
} from "@/components/MemoContent/kanban/columns";
import { parseKanbanBlock } from "@/components/MemoContent/kanban/parseKanbanBlock";
import { PRIORITY_BADGE } from "@/components/MemoContent/kanban/priority";
import type { KanbanTask } from "@/components/MemoContent/kanban/types";
import { Link } from "@/components/MemoContent/markdown/Link";
import { cn } from "@/lib/utils";
import { COPY } from "../copy";

/**
 * A ```kanban block on the phone, read-only (phase 3 §4): the columns stacked top
 * to bottom, each a list of its cards, from the same columns and order as the web
 * board. Stacked rather than swiped sideways: the page already scrolls vertically,
 * a sideways scroller inside it fights Safari's edge-swipe back, and a phone fits
 * barely more than one column across anyway. Tapping a card shows its details;
 * nothing is dragged, ticked or written back.
 */
export default function KanbanPreview({ content }: { content: string }) {
  const data = useMemo(() => parseKanbanBlock(content), [content]);
  const columns = useMemo(() => buildKanbanColumns(data), [data]);
  // The selected card stays set while the sheet slides away, so its contents don't vanish mid-animation.
  const [selected, setSelected] = useState<KanbanTask>();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (data.tasks.length === 0) {
    return <div className="not-prose text-[15px] text-black/45 dark:text-white/45">{COPY.blockPreview.kanbanEmpty}</div>;
  }
  return (
    <div className="not-prose flex flex-col gap-4">
      {columns.map((column) => (
        <KanbanColumn
          key={column.key}
          title={column.key === UNGROUPED_KEY ? COPY.blockPreview.ungrouped : column.key}
          tasks={column.tasks}
          onSelect={(task) => {
            setSelected(task);
            setSheetOpen(true);
          }}
        />
      ))}
      <TaskSheet task={selected} opened={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}

function KanbanColumn({ title, tasks, onSelect }: { title: string; tasks: KanbanTask[]; onSelect: (task: KanbanTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  const overflow = tasks.length - COLLAPSED_LIMIT;
  const visible = expanded ? tasks : tasks.slice(0, COLLAPSED_LIMIT);
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-[15px] font-semibold truncate">{title}</span>
        <span className="shrink-0 rounded-full bg-black/[0.06] dark:bg-white/[0.1] px-1.5 text-[12px] text-black/50 dark:text-white/55">
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="px-1 text-[13px] text-black/40 dark:text-white/40">{COPY.blockPreview.columnEmpty}</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] divide-y divide-black/[0.08] dark:divide-white/[0.1]">
          {visible.map((task, index) => (
            <TaskRow key={task.id ?? `${task.srcIndex}-${index}`} task={task} onSelect={onSelect} />
          ))}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-center gap-1 py-2 text-[13px] text-primary active:opacity-50"
            >
              {expanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
              {expanded ? COPY.blockPreview.showLess : COPY.blockPreview.showMore(overflow)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TaskRow({ task, onSelect }: { task: KanbanTask; onSelect: (task: KanbanTask) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <DoneMark done={!!task.done} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-[15px] leading-snug line-clamp-2", task.done && "line-through text-black/45 dark:text-white/45")}>
          {task.title}
        </div>
        <TaskMeta task={task} />
      </div>
    </button>
  );
}

/** Whether a task is done, as a mark only: the phone does not tick tasks. */
function DoneMark({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border",
        done ? "bg-primary border-primary text-white" : "border-black/25 dark:border-white/30",
      )}
      aria-label={done ? COPY.blockPreview.done : COPY.blockPreview.notDone}
    >
      {done && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

function TaskMeta({ task }: { task: KanbanTask }) {
  if (!task.priority && !task.due && task.tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {task.priority && (
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", PRIORITY_BADGE[task.priority])}>
          {COPY.blockPreview.priority[task.priority]}
        </span>
      )}
      {task.due && (
        <span className="inline-flex items-center gap-1 text-[12px] text-black/50 dark:text-white/50">
          <CalendarIcon className="h-3 w-3" />
          {task.due}
        </span>
      )}
      {task.tags.map((tag) => (
        <span key={tag} className="rounded bg-black/[0.05] dark:bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-black/50 dark:text-white/55">
          #{tag}
        </span>
      ))}
    </div>
  );
}

/** A card's details, the same fields as the web board's detail panel, in the same order. */
function detailRows(task: KanbanTask): [string, ReactNode][] {
  const label = COPY.blockPreview.field;
  const rows: [string, ReactNode][] = [];
  if (task.status) rows.push([label.status, task.status]);
  if (task.priority) rows.push([label.priority, COPY.blockPreview.priority[task.priority]]);
  rows.push([label.done, task.done ? COPY.blockPreview.done : COPY.blockPreview.notDone]);
  if (task.due) rows.push([label.due, task.due]);
  if (task.tags.length > 0) rows.push([label.tags, task.tags.map((tag) => `#${tag}`).join(" ")]);
  if (task.id) rows.push(["ID", task.id]);
  if (task.createAt) rows.push([label.created, task.createAt]);
  if (task.updateAt) rows.push([label.updated, task.updateAt]);
  for (const [key, value] of taskCustomEntries(task)) rows.push([key, formatTaskValue(value)]);
  return rows;
}

/**
 * A card's details in a bottom sheet. A linked title opens that document (or page)
 * the way a link in the text would. The sheet goes to the app root: inside the
 * content it would be scaled by the reading zoom.
 */
function TaskSheet({ task, opened, onClose }: { task?: KanbanTask; opened: boolean; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(".k-app") ?? document.body;
  return createPortal(
    <Sheet className="pb-safe w-full max-h-[75vh] rounded-t-2xl" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      {task && (
        <div className="overflow-y-auto max-h-[calc(75vh-20px)] px-4 pt-3 pb-6">
          <div className="text-[18px] font-semibold leading-snug break-words">
            {task.link ? (
              <Link href={task.link} className="text-primary">
                {task.title}
              </Link>
            ) : (
              task.title
            )}
          </div>
          <div className="mt-3 overflow-hidden rounded-xl bg-black/[0.03] dark:bg-white/[0.06] divide-y divide-black/[0.08] dark:divide-white/[0.1]">
            {detailRows(task).map(([key, value]) => (
              <div key={key} className="flex gap-3 px-3 py-2 text-[15px]">
                <span className="w-20 shrink-0 text-black/45 dark:text-white/45 truncate">{key}</span>
                <span className="mobile-selectable min-w-0 flex-1 break-words">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>,
    root,
  );
}
