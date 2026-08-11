import { createContext, type ReactNode, useContext } from "react";
import { type WorkspaceTreeNode, WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

/**
 * Resolves in-workspace root-relative markdown links (e.g. `[x](/milestones/university-admission)`)
 * to a target memo, and navigates to it. Provided by whichever surface owns the workspace tree
 * (the Notebook preview and the memo detail page). When absent, root-relative links fall back to
 * plain external-link behavior.
 */
export interface DocumentLinkContextValue {
  /** Returns the target memo resource name (`memos/{uid}`) for a root-relative href, or undefined if unresolvable. */
  resolve: (href: string) => string | undefined;
  /** Navigates to the resolved memo. `href` is the original markdown href, for context if needed. */
  navigate: (memoName: string, href: string) => void;
  /**
   * Lists documents in the current workspace as root-relative paths, for the editor's `![[`
   * embed-target autocomplete. Absent (e.g. in share mode, with no workspace tree) means the
   * autocomplete has nothing to offer and stays silent.
   */
  listDocuments?: () => Array<{ path: string; title: string }>;
}

const DocumentLinkContext = createContext<DocumentLinkContextValue | null>(null);

export const DocumentLinkProvider = ({ value, children }: { value: DocumentLinkContextValue; children: ReactNode }) => {
  return <DocumentLinkContext.Provider value={value}>{children}</DocumentLinkContext.Provider>;
};

export const useDocumentLinkContext = (): DocumentLinkContextValue | null => useContext(DocumentLinkContext);

const DOC_EXTENSION = /\.(md|markdown|html?|pdf)$/i;

// Mirrors internal/linkindex/resolve.go's absoluteMemoHrefRe: the compat
// "copy link" form, uid-addressed and never affected by rename/move.
const ABSOLUTE_MEMO_HREF_RE = /^\/memos\/([^/?#]+)$/;

/**
 * A root-relative document href is the canonical in-workspace link form per
 * docs/dev/requirements/cross-reference-repair-on-move-rename.md
 * ("链接的规范形式"): a site-absolute path that is NOT the /memos/{uid} compat
 * form. This must stay provably equivalent to IsRootRelativeDocHref in
 * internal/linkindex/resolve.go — the design doc calls this pairing out as
 * the highest-risk spot for frontend/backend drift, since a link that one
 * side resolves and the other doesn't either renders broken when it isn't,
 * or navigates when it shouldn't.
 *
 * Deliberately NOT accepted (per the 2026-08-07 requirements rewrite):
 * scheme-qualified URLs, bare fragments, and plain relative paths with no
 * leading "/" — the old relative-path-with-title-fallback scheme is retired.
 */
export function isRootRelativeDocHref(href: string | undefined): href is string {
  if (!href) return false;
  if (!href.startsWith("/")) return false;
  if (isAbsoluteMemoHref(href)) return false;
  return true;
}

function isAbsoluteMemoHref(href: string): boolean {
  let h = href.split(/[?#]/)[0];
  try {
    // Full URLs ("{host}/memos/{uid}") reduce to their path component.
    const u = new URL(h);
    h = u.pathname;
  } catch {
    // Not a full URL; h is already a bare path.
  }
  return ABSOLUTE_MEMO_HREF_RE.test(h);
}

/**
 * Extracts the memo uid from an absolute-form link ("/memos/{uid}" or
 * "{host}/memos/{uid}"), or undefined for any other href shape. Mirrors
 * ResolveAbsoluteMemoHref in internal/linkindex/resolve.go.
 */
export function resolveAbsoluteMemoHref(href: string): string | undefined {
  let h = href.split(/[?#]/)[0];
  try {
    const u = new URL(h);
    h = u.pathname;
  } catch {
    // keep h as-is
  }
  const m = ABSOLUTE_MEMO_HREF_RE.exec(h);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function stripExt(value: string): string {
  return value.replace(DOC_EXTENSION, "");
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
 * Resolves a workspace-root-relative markdown href ("/doc/api.md") against a workspace tree,
 * returning the target memo resource name. This ports ResolveRootRelativePath from
 * internal/linkindex/resolve.go: the final path segment names the document (matched against its
 * title, extension-agnostic, case-insensitive), the leading segments are exact-name folder matches
 * against the workspace root. There is no fallback of any kind — a path that doesn't resolve this
 * way is a broken link, not a cue to search the rest of the tree by title or to try relative
 * navigation. Any change here must be mirrored in ResolveRootRelativePath on the backend, or the
 * two will disagree about which links are broken.
 *
 * Document nodes carry their title as `name`; their stored `path` is folder + UID, so matching is
 * done on folder names + document `name`, never on the stored `path`.
 */
/**
 * Flattens a workspace tree into its markdown documents as root-relative paths (`node.path` is
 * already workspace-relative and title-terminated, matching what `resolveWorkspacePath` expects
 * back), for the `![[` embed-target autocomplete. `excludeMemoName`, when given, omits that
 * document (typically the one currently open, to discourage self-embedding).
 */
export function flattenWorkspaceDocuments(tree: WorkspaceTreeNode[], excludeMemoName?: string): Array<{ path: string; title: string }> {
  const results: Array<{ path: string; title: string }> = [];
  const visit = (nodes: WorkspaceTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === WorkspaceTreeNode_NodeType.FOLDER) {
        visit(node.children);
      } else if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT && node.docType === "MARKDOWN" && node.memo !== excludeMemoName) {
        results.push({ path: node.path, title: node.name });
      }
    }
  };
  visit(tree);
  return results;
}

export function resolveWorkspacePath(tree: WorkspaceTreeNode[], href: string): string | undefined {
  let path = href;
  try {
    path = decodeURIComponent(href);
  } catch {
    // keep raw href if it isn't valid percent-encoding
  }
  path = path.split(/[?#]/)[0]; // drop any query string / fragment
  const segments = path.split("/").filter((s) => s !== "");
  if (segments.length === 0) return undefined;

  const title = stripExt(segments[segments.length - 1]);
  const folderSegments = segments.slice(0, -1);
  return findDocInFolder(tree, folderSegments, title);
}
