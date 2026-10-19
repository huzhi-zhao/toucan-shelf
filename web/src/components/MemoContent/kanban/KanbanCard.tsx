import { CalendarIcon, CheckIcon } from "lucide-react";
import { Link } from "@/components/MemoContent/markdown/Link";
import { cn } from "@/lib/utils";
import type { DragPayload } from "./KanbanColumn";
import { PRIORITY_BADGE } from "./priority";
import type { KanbanTask } from "./types";

interface KanbanCardProps {
  task: KanbanTask;
  selected: boolean;
  interactive: boolean;
  onSelect: (task: KanbanTask) => void;
  onToggleDone: (task: KanbanTask, done: boolean) => void;
}

export const KanbanCard = ({ task, selected, interactive, onSelect, onToggleDone }: KanbanCardProps) => {
  const handleDragStart = (event: React.DragEvent) => {
    const payload: DragPayload = { srcIndex: task.srcIndex, id: task.id };
    event.dataTransfer.setData("application/x-kanban-task", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={interactive}
      onDragStart={interactive ? handleDragStart : undefined}
      onClick={() => onSelect(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(task);
        }
      }}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2.5 bg-card text-left transition-all",
        "hover:shadow-sm hover:border-accent cursor-pointer",
        interactive && "active:cursor-grabbing",
        selected ? "border-primary ring-1 ring-primary/40" : "border-border",
        task.done && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={!interactive}
          aria-pressed={task.done}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDone(task, !task.done);
          }}
          className={cn(
            "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border",
            task.done ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50",
            interactive ? "cursor-pointer" : "cursor-default",
          )}
        >
          {task.done && <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />}
        </button>
        {task.link ? (
          // Clicking the title navigates (in-workspace doc or external URL) rather than selecting the
          // card; stopPropagation keeps the card's own onClick/keydown selection from also firing.
          <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Link
              href={task.link}
              title={task.title}
              className={cn("block truncate text-sm font-medium leading-snug", task.done && "line-through text-muted-foreground")}
            >
              {task.title}
            </Link>
          </span>
        ) : (
          <span
            title={task.title}
            className={cn("min-w-0 flex-1 truncate text-sm font-medium leading-snug", task.done && "line-through text-muted-foreground")}
          >
            {task.title}
          </span>
        )}
      </div>

      {(task.priority || task.due || task.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {task.priority && (
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", PRIORITY_BADGE[task.priority])}>{task.priority}</span>
          )}
          {task.due && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarIcon className="h-3 w-3" />
              {task.due}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
