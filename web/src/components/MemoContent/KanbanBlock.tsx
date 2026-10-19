import { useMemo, useState } from "react";
import { useTranslate } from "@/utils/i18n";
import { useBlockSource } from "./BlockSourceContext";
import { buildKanbanColumns, UNGROUPED_KEY } from "./kanban/columns";
import { KanbanColumn } from "./kanban/KanbanColumn";
import { KanbanTaskDetail } from "./kanban/KanbanTaskDetail";
import { parseKanbanBlock } from "./kanban/parseKanbanBlock";
import { addTask, setTaskDone, setTaskStatus } from "./kanban/serializeKanbanBlock";
import type { KanbanTask } from "./kanban/types";
import { extractCodeContent } from "./utils";

interface KanbanBlockProps {
  children?: React.ReactNode;
  className?: string;
}

export const KanbanBlock = ({ children }: KanbanBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const data = useMemo(() => parseKanbanBlock(codeContent), [codeContent]);
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(undefined);

  const blockSource = useBlockSource();
  const readonly = blockSource?.readonly ?? true;
  // `view.lock: true` pins the board as view-only even when the document is
  // otherwise editable.
  const interactive = !!blockSource && !readonly && !data.view.lock;

  // Selection is tracked by srcIndex so it survives re-parsing after a write.
  const selectedTask = useMemo(() => data.tasks.find((task) => task.srcIndex === selectedIndex), [data.tasks, selectedIndex]);

  const writeContent = (newContent: string) => {
    blockSource?.save(newContent);
  };

  const handleToggleDone = (task: KanbanTask, done: boolean) => {
    if (!blockSource) return;
    writeContent(setTaskDone(blockSource.source, task.srcIndex, task.id, done));
  };

  const handleMoveTask = (payload: { srcIndex: number; id?: string }, status: string) => {
    if (!blockSource || status === UNGROUPED_KEY) return;
    writeContent(setTaskStatus(blockSource.source, payload.srcIndex, payload.id, status));
  };

  const handleAddTask = (status: string, title: string) => {
    if (!blockSource || status === UNGROUPED_KEY) return;
    writeContent(addTask(blockSource.source, status, title));
  };

  const columns = useMemo(
    () =>
      buildKanbanColumns(data).map((column) => ({
        ...column,
        title: column.key === UNGROUPED_KEY ? t("markdown.kanban-block.ungrouped") : column.key,
      })),
    [data, t],
  );

  if (data.tasks.length === 0) {
    return <div className="px-1 py-2 text-sm text-muted-foreground">{t("markdown.kanban-block.empty")}</div>;
  }

  // Only status columns accept add/move; a groupBy on another field can't derive
  // the value to write, and the ungrouped bucket has no key to assign.
  const canEditColumn = interactive && data.view.groupBy === "status";

  return (
    <div className="not-prose flex flex-col gap-3">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((column) => (
          <KanbanColumn
            key={column.key}
            columnKey={column.key}
            title={column.title}
            tasks={column.tasks}
            selectedTask={selectedTask}
            onSelectTask={(task) => setSelectedIndex(task.srcIndex)}
            interactive={interactive}
            canEditColumn={canEditColumn && column.key !== UNGROUPED_KEY}
            onToggleDone={handleToggleDone}
            onMoveTask={handleMoveTask}
            onAddTask={handleAddTask}
          />
        ))}
      </div>
      <div className="rounded-lg border border-border/60 px-3 py-2">
        <KanbanTaskDetail task={selectedTask} />
      </div>
    </div>
  );
};
