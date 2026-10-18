import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { extractTasks } from "@/utils/markdown-manipulation";

export interface KbTodoGroup {
  workspace: string;
  /** The knowledge base's title. */
  title: string;
  /** The knowledge base's TODO document. */
  memo: string;
  todos: string[];
}

/**
 * Whether this is a knowledge base's TODO document: titled "TODO" (any case, a stray ".md" allowed) and
 * sitting at the root. Only that one holds todos meant for a person; task lists anywhere else in a knowledge
 * base are working notes, many of them written for agents, and stay out of the list (phase 3 §3).
 */
export const isRootTodoDoc = (memo: Pick<Memo, "title" | "folderPath" | "parent">): boolean =>
  !memo.parent && memo.folderPath === "" && memo.title.trim().replace(/\.md$/i, "").toUpperCase() === "TODO";

/**
 * The knowledge bases' open todos: every empty `[ ]` in each knowledge base's root TODO document, one group
 * per knowledge base in shelf order. Only a plain empty box counts; `[x]` and the extended markers (`[>]`,
 * `[/]`, …) do not, and anything inside a code block is not a task at all. Knowledge bases missing from
 * `workspaces` (hidden ones) are left out.
 */
export function groupKbTodos(memos: Memo[], workspaces: Pick<Workspace, "name" | "title">[]): KbTodoGroup[] {
  const todoDocs = new Map<string, Memo>();
  for (const memo of memos) {
    if (!isRootTodoDoc(memo)) continue;
    // Two root TODO documents in one knowledge base should not happen; keep the most recently edited one.
    const seen = todoDocs.get(memo.workspace);
    if (!seen || Number(memo.updateTime?.seconds ?? 0) > Number(seen.updateTime?.seconds ?? 0)) todoDocs.set(memo.workspace, memo);
  }
  const groups: KbTodoGroup[] = [];
  for (const workspace of workspaces) {
    const memo = todoDocs.get(workspace.name);
    if (!memo) continue;
    const todos = extractTasks(memo.content)
      .filter((task) => task.marker === " " && task.content.trim() !== "")
      .map((task) => task.content.trim());
    if (todos.length > 0) groups.push({ workspace: workspace.name, title: workspace.title, memo: memo.name, todos });
  }
  return groups;
}
