import { Link } from "@/components/MemoContent/markdown/Link";
import { useTranslate } from "@/utils/i18n";
import { formatTaskValue, taskCustomEntries } from "./columns";
import type { KanbanTask } from "./types";

interface KanbanTaskDetailProps {
  task?: KanbanTask;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex gap-3 py-1 text-sm">
    <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words">{value}</span>
  </div>
);

export const KanbanTaskDetail = ({ task }: KanbanTaskDetailProps) => {
  const t = useTranslate();

  if (!task) {
    return <div className="px-1 py-4 text-sm text-muted-foreground">{t("markdown.kanban-block.select-task")}</div>;
  }

  const customEntries = taskCustomEntries(task);

  return (
    <div className="flex flex-col">
      <div className="mb-2 text-base font-semibold">{task.link ? <Link href={task.link}>{task.title}</Link> : task.title}</div>
      {task.status && <Row label={t("markdown.kanban-block.field.status")} value={task.status} />}
      {task.priority && <Row label={t("markdown.kanban-block.field.priority")} value={task.priority} />}
      <Row label={t("markdown.kanban-block.field.done")} value={task.done ? "✔" : "—"} />
      {task.due && <Row label={t("markdown.kanban-block.field.due")} value={task.due} />}
      {task.tags.length > 0 && <Row label={t("markdown.kanban-block.field.tags")} value={task.tags.map((tag) => `#${tag}`).join(" ")} />}
      {task.id && <Row label="ID" value={task.id} />}
      {task.createAt && <Row label={t("markdown.kanban-block.field.created")} value={task.createAt} />}
      {task.updateAt && <Row label={t("markdown.kanban-block.field.updated")} value={task.updateAt} />}
      {customEntries.map(([key, value]) => (
        <Row key={key} label={key} value={formatTaskValue(value)} />
      ))}
    </div>
  );
};
