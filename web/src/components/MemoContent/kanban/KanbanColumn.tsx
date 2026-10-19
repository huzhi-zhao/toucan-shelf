import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { COLLAPSED_LIMIT } from "./columns";
import { KanbanCard } from "./KanbanCard";
import type { KanbanTask } from "./types";

export interface DragPayload {
  srcIndex: number;
  id?: string;
}

interface KanbanColumnProps {
  columnKey: string;
  title: string;
  tasks: KanbanTask[];
  selectedTask?: KanbanTask;
  onSelectTask: (task: KanbanTask) => void;
  interactive: boolean;
  canEditColumn: boolean;
  onToggleDone: (task: KanbanTask, done: boolean) => void;
  onMoveTask: (payload: DragPayload, status: string) => void;
  onAddTask: (status: string, title: string) => void;
}

export const KanbanColumn = ({
  columnKey,
  title,
  tasks,
  selectedTask,
  onSelectTask,
  interactive,
  canEditColumn,
  onToggleDone,
  onMoveTask,
  onAddTask,
}: KanbanColumnProps) => {
  const t = useTranslate();
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);

  // Cap a column at COLLAPSED_LIMIT cards, hiding the rest behind a "more" toggle
  // so a long column doesn't stretch the board.
  const overflow = tasks.length - COLLAPSED_LIMIT;
  const visibleTasks = expanded ? tasks : tasks.slice(0, COLLAPSED_LIMIT);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (!canEditColumn) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-kanban-task")) as DragPayload;
      if (typeof payload.srcIndex === "number") onMoveTask(payload, columnKey);
    } catch {
      // Ignore drops carrying an unrecognized payload.
    }
  };

  const submitDraft = () => {
    const value = draft.trim();
    if (value) onAddTask(columnKey, value);
    setDraft("");
    setAdding(false);
  };

  return (
    <div
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg bg-muted/30 p-2 transition-colors",
        dragOver && canEditColumn && "bg-accent/40 ring-1 ring-primary/40",
      )}
      onDragOver={(event) => {
        if (!canEditColumn) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {visibleTasks.map((task, index) => (
          <KanbanCard
            key={task.id ?? `${task.title}-${index}`}
            task={task}
            selected={task === selectedTask}
            interactive={interactive}
            onSelect={onSelectTask}
            onToggleDone={onToggleDone}
          />
        ))}
      </div>

      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2 flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="h-3.5 w-3.5" />
              {t("markdown.kanban-block.show-less")}
            </>
          ) : (
            <>
              <ChevronDownIcon className="h-3.5 w-3.5" />
              {t("markdown.kanban-block.show-more", { count: overflow })}
            </>
          )}
        </button>
      )}

      {canEditColumn &&
        (adding ? (
          <textarea
            autoFocus
            rows={2}
            value={draft}
            placeholder={t("markdown.kanban-block.add-placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              } else if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            className="mt-2 w-full resize-none rounded-md border border-border bg-card p-2 text-sm outline-none focus:border-primary"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {t("markdown.kanban-block.add-task")}
          </button>
        ))}
    </div>
  );
};
