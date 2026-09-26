import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

export type NotebookSortField = "createTime" | "updateTime" | "alphabetical";
export type NotebookSortOrder = "asc" | "desc";

export const DEFAULT_SORT_FIELD: NotebookSortField = "createTime";
export const DEFAULT_SORT_ORDER: NotebookSortOrder = "desc";

export function normalizeSortField(field: string | undefined): NotebookSortField {
  return field === "createTime" || field === "updateTime" || field === "alphabetical" ? field : DEFAULT_SORT_FIELD;
}

export function normalizeSortOrder(order: string | undefined): NotebookSortOrder {
  return order === "asc" || order === "desc" ? order : DEFAULT_SORT_ORDER;
}

function compareNodes(a: WorkspaceTreeNode, b: WorkspaceTreeNode, field: NotebookSortField): number {
  if (field === "alphabetical") {
    return a.name.localeCompare(b.name);
  }
  const aTime = field === "createTime" ? a.createTime : a.updateTime;
  const bTime = field === "createTime" ? b.createTime : b.updateTime;
  const aSeconds = aTime ? Number(aTime.seconds) : 0;
  const bSeconds = bTime ? Number(bTime.seconds) : 0;
  return aSeconds - bSeconds;
}

/**
 * Resolve one folder's own override against what it would otherwise inherit.
 * An empty override means "inherit", and so does an unrecognized one: falling
 * back to the global default there would silently break the inheritance chain
 * for every folder below.
 */
export function resolveSortField(own: string | undefined, inherited: NotebookSortField): NotebookSortField {
  return own === "createTime" || own === "updateTime" || own === "alphabetical" ? own : inherited;
}

export function resolveSortOrder(own: string | undefined, inherited: NotebookSortOrder): NotebookSortOrder {
  return own === "asc" || own === "desc" ? own : inherited;
}

/**
 * Sort a level of the tree, then each folder's contents under that folder's own
 * rule. `field`/`order` are what this level inherits — the workspace's setting at
 * the root, and the resolved rule of the enclosing folder further down. A folder's
 * override governs the documents *inside* it, not where the folder itself lands
 * among its siblings, which is the enclosing level's business.
 */
export function sortTree(
  nodes: WorkspaceTreeNode[],
  field: NotebookSortField,
  order: NotebookSortOrder,
  foldersFirst = false,
): WorkspaceTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (foldersFirst) {
      const aIsFolder = a.type === WorkspaceTreeNode_NodeType.FOLDER;
      const bIsFolder = b.type === WorkspaceTreeNode_NodeType.FOLDER;
      if (aIsFolder !== bIsFolder) {
        return aIsFolder ? -1 : 1;
      }
    }
    const result = compareNodes(a, b, field);
    return order === "asc" ? result : -result;
  });
  return sorted.map((node) => {
    if (node.type !== WorkspaceTreeNode_NodeType.FOLDER || node.children.length === 0) return node;
    return {
      ...node,
      children: sortTree(node.children, resolveSortField(node.sortField, field), resolveSortOrder(node.sortOrder, order), foldersFirst),
    };
  });
}
