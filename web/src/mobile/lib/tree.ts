import { type WorkspaceTreeNode, WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

/** The children of the folder at `folderPath` ("" is the root), or undefined when no such folder exists. */
export function findFolderChildren(tree: WorkspaceTreeNode[], folderPath: string): WorkspaceTreeNode[] | undefined {
  if (!folderPath) return tree;
  for (const node of tree) {
    if (node.type !== WorkspaceTreeNode_NodeType.FOLDER) continue;
    if (node.path === folderPath) return node.children;
    if (folderPath.startsWith(`${node.path}/`)) return findFolderChildren(node.children, folderPath);
  }
  return undefined;
}

/** Number of documents anywhere below a node (a document counts itself). */
export function countDocuments(node: WorkspaceTreeNode): number {
  if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT) return 1;
  return node.children.reduce((sum, child) => sum + countDocuments(child), 0);
}

/** The folder one level up; "" from a top-level folder. */
export function parentFolderPath(folderPath: string): string {
  const index = folderPath.lastIndexOf("/");
  return index < 0 ? "" : folderPath.slice(0, index);
}

/** Last segment of a folder path, i.e. the folder's own name. */
export function folderName(folderPath: string): string {
  return folderPath.slice(folderPath.lastIndexOf("/") + 1);
}
