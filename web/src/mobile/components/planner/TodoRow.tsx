import dayjs from "dayjs";
import { ListItem } from "konsta/react";
import { CheckIcon, StarIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Todo, Todo_Status } from "@/types/proto/api/v1/planner_service_pb";
import { COPY } from "../../copy";
import { isOverdue } from "../../lib/planner";

interface Props {
  todo: Todo;
  today: string;
  /** Show the date on the right; the day list leaves it out for the day's own todos. */
  showDate?: boolean;
  /** The round button: complete an active todo, reopen a done one (unless it checked in its habit). */
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
}

/**
 * One todo: a round check on the left, the title (tap for details), and the date.
 * Overdue todos are red, closed ones muted; cancelling needs a reason, so it lives
 * on the detail page rather than on this row.
 */
export default function TodoRow({ todo, today, showDate, onToggle, onOpen }: Props) {
  const overdue = isOverdue(todo, today);
  const done = todo.status === Todo_Status.DONE;
  const cancelled = todo.status === Todo_Status.CANCELLED;
  const closed = done || cancelled;
  // A todo whose completion checked in its habit cannot be reopened.
  const settled = done && todo.checkInDate !== "";
  const dateLabel = todo.date ? dayjs(todo.date).format(todo.date.slice(0, 4) === today.slice(0, 4) ? "M/D" : "YYYY/M/D") : "";

  return (
    <ListItem
      link
      chevron={false}
      onClick={() => onOpen(todo)}
      media={
        <button
          type="button"
          aria-label={done ? COPY.todo.reopen : COPY.todo.complete}
          disabled={cancelled || settled}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(todo);
          }}
          // The padding widens the hit area beyond the circle: it sits right next to the row's own tap target.
          className="-m-2 p-2 flex items-center justify-center"
        >
          <span
            className={cn(
              "w-[22px] h-[22px] rounded-full border-[1.5px] flex items-center justify-center",
              done && "bg-primary border-primary text-white",
              cancelled && "border-black/25 dark:border-white/25 text-black/40 dark:text-white/40",
              !closed && (overdue ? "border-red-500" : "border-black/30 dark:border-white/35"),
            )}
          >
            {done && <CheckIcon className="w-3.5 h-3.5" strokeWidth={3} />}
            {cancelled && <XIcon className="w-3 h-3" strokeWidth={2.5} />}
          </span>
        </button>
      }
      title={
        <span className={cn("flex items-center gap-1.5", closed && "text-black/40 dark:text-white/40", cancelled && "line-through")}>
          {todo.important && !closed && <StarIcon className="w-3.5 h-3.5 shrink-0 text-amber-500" fill="currentColor" />}
          <span className="whitespace-normal">{todo.title}</span>
        </span>
      }
      after={
        (showDate || overdue) && dateLabel ? (
          <span className={cn("text-[13px]", overdue ? "text-red-500" : "text-black/45 dark:text-white/45")}>
            {overdue ? `${COPY.todo.overdue} · ${dateLabel}` : dateLabel}
          </span>
        ) : undefined
      }
    />
  );
}
