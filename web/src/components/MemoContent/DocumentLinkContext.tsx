import { createContext, type ReactNode, useContext } from "react";
import { type WorkspaceTreeNode, WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

/**
 * Resolves in-workspace relative markdown links (e.g. `[x](milestones/M-PRE02_university-admission.md)`)
 * to a target memo, and navigates to it. Provided by whichever surface owns the workspace tree
 * (the Notebook preview and the memo detail page). When absent, relative links fall back to plain
 * external-link behavior.
 */
export interface DocumentLinkContextValue {
  /** Returns the target memo resource name (`memos/{uid}`) for a relative href, or undefined if unresolvable. */
  resolve: (href: string) => string | undefined;
  /** Navigates to the resolved memo. `href` is the original markdown href, for context if needed. */
  navigate: (memoName: string, href: string) => void;
}

const DocumentLinkContext = createContext<DocumentLinkContextValue | null>(null);

export const DocumentLinkProvider = ({ value, children }: { value: DocumentLinkContextValue; children: ReactNode }) => {
  return <DocumentLinkContext.Provider value={value}>{children}</DocumentLinkContext.Provider>;
};

export const useDocumentLinkContext = (): DocumentLinkContextValue | null => useContext(DocumentLinkContext);

const DOC_EXTENSION = /\.(md|markdown|html?|pdf)$/i;

/**
 * A relative document link is one without a URL scheme, not an in-page anchor, and not site-absolute.
 * Those are the hrefs that could point at another document inside the same workspace.
 */
export function isRelativeDocHref(href: string | undefined): href is string {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // scheme: http:, https:, mailto:, etc.
  if (href.startsWith("#")) return false; // in-page anchor
  if (href.startsWith("/")) return false; // site-absolute (covers protocol-relative //)
  return true;
}

function stripExt(value: string): string {
  return value.replace(DOC_EXTENSION, "");
}

function findDocByTitle(nodes: WorkspaceTreeNode[], title: string): string | undefined {
  const lower = title.toLowerCase();
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT && stripExt(node.name).toLowerCase() === lower) {
      return node.memo;
    }
    const found = findDocByTitle(node.children, title);
    if (found) return found;
  }
  return undefined;
}

/** Finds the document with `title` inside the folder addressed by `folderSegments`, or undefined. */
function findDocInFolder(tree: WorkspaceTreeNode[], folderSegments: string[], title: string): string | undefined {
  let nodes: WorkspaceTreeNode[] = tree;
  for (const seg of folderSegments) {
    const folder = nodes.find((n) => n.type === WorkspaceTreeNode_NodeType.FOLDER && n.name === seg);
    if (!folder) return undefined;
    nodes = folder.children;
  }
  const lower = title.toLowerCase();
  const doc = nodes.find((n) => n.type === WorkspaceTreeNode_NodeType.DOCUMENT && stripExt(n.name).toLowerCase() === lower);
  return doc?.memo;
}

/**
 * Resolves a relative markdown href against a workspace tree, returning the target memo resource name.
 *
 * The href is a slash-separated filesystem-style path: the final segment names the document (matched
 * against its title, extension-insensitive) and the leading segments navigate folders — `..` goes up,
 * `.` stays put. It is resolved **relative to the current document's folder** (`baseFolderPath`), which
 * is how generic markdown links behave (e.g. a bare `Calendar_Test.md` means "the sibling document in
 * this same folder"). If that fails, it falls back to treating the path as workspace-root-relative, then
 * to a title match anywhere in the tree (so links keep working after a document is moved).
 *
 * Document nodes carry their title as `name`; their stored `path` is folder + UID, so matching is done
 * on folder names + document `name`, never on the stored `path`.
 */
export function resolveWorkspacePath(tree: WorkspaceTreeNode[], href: string, baseFolderPath = ""): string | undefined {
  let path = href;
  try {
    path = decodeURIComponent(href);
  } catch {
    // keep raw href if it isn't valid percent-encoding
  }
  path = path.split(/[?#]/)[0]; // drop any query string / fragment
  const rawSegments = path.split("/").filter((s) => s !== "");
  if (rawSegments.length === 0) return undefined;

  const title = stripExt(rawSegments[rawSegments.length - 1]);
  const navSegments = rawSegments.slice(0, -1); // folder navigation (may contain "." / "..")

  // Apply the navigation against the current document's folder to get the target folder path.
  const base = baseFolderPath.split("/").filter((s) => s !== "");
  const resolved = [...base];
  for (const seg of navSegments) {
    if (seg === ".") continue;
    if (seg === "..") {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  // 1. Relative to the current folder (standard markdown behavior).
  const relative = findDocInFolder(tree, resolved, title);
  if (relative) return relative;

  // 2. Relative to the workspace root (some ported docs write root-relative paths).
  if (navSegments.length > 0) {
    const rootRelative = findDocInFolder(
      tree,
      navSegments.filter((s) => s !== "." && s !== ".."),
      title,
    );
    if (rootRelative) return rootRelative;
  }

  // 3. Last resort: match the title anywhere in the tree (survives moves / differing folder layout).
  return findDocByTitle(tree, title);
}
