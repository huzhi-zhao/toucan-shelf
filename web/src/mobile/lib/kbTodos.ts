import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { extractTasks } from "@/utils/markdown-manipulation";
import { isSubDocument } from "@/utils/subDoc";

export interface KbTodoDoc {
  memo: string;
  title: string;
  icon: string;
  /** "MARKDOWN", "HTML", … as the tree reports it, for DocGlyph. */
  docType: string;
  todos: string[];
}

export interface KbTodoGroup {
  workspace: string;
  title: string;
  docs: KbTodoDoc[];
}

/**
 * The knowledge bases' open todos (phase 3 §3): every empty `[ ]` in the given documents, by knowledge base
 * in shelf order, then by document, most recently edited first. Only a plain empty box counts; `[x]` and the
 * extended markers (`[>]`, `[/]`, …) do not, and anything inside a code block (a `calendar` block's `[ ]`)
 * is not a task at all. Knowledge bases missing from `workspaces` (hidden ones) and comments are left out.
 */
export function groupKbTodos(memos: Memo[], workspaces: Pick<Workspace, "name" | "title">[]): KbTodoGroup[] {
  const groups = new Map(
    workspaces.map((ws) => [ws.name, { workspace: ws.name, title: ws.title, docs: [] as (KbTodoDoc & { at: number })[] }]),
  );
  for (const memo of memos) {
    const group = groups.get(memo.workspace);
    if (!group || (memo.parent && !isSubDocument(memo))) continue;
    const todos = extractTasks(memo.content)
      .filter((task) => task.marker === " " && task.content.trim() !== "")
      .map((task) => task.content.trim());
    if (todos.length === 0) continue;
    group.docs.push({
      memo: memo.name,
      title: memo.title,
      icon: memo.icon,
      docType: Memo_DocType[memo.docType] ?? "",
      todos,
      at: Number(memo.updateTime?.seconds ?? 0),
    });
  }
  return [...groups.values()]
    .filter((group) => group.docs.length > 0)
    .map((group) => ({ ...group, docs: group.docs.sort((a, b) => b.at - a.at).map(({ at: _at, ...doc }) => doc) }));
}
