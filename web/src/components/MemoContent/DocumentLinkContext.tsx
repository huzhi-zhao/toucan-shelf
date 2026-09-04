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
  /**
   * Folder of the document whose content is being rendered ("" at the workspace
   * root). Document-relative hrefs (`./x.md`, `../fb/x.md`) resolve against it,
   * so it must track the document the markdown actually came from — not the
   * page's own document. Absent means relative hrefs cannot be resolved.
   */
  baseFolderPath?: string;
  /**
   * Same resolution as `resolve`, but against an explicitly given base folder.
   * Embedded content (`![[...]]`) is rendered inside the *host* document's
   * provider, so it needs this to resolve its own relative links against its
   * own folder rather than the host's.
   */
  resolveFrom?: (baseFolderPath: string, href: string) => string | undefined;
  /**
   * Resolves a workspace-qualified href (`@库标题/fb/dc.md`) against the
   * knowledge-base trees prefetched for this document. Stays synchronous — see
   * useCrossWorkspaceTrees for why. Absent means the surface does not support
   * cross-workspace links at all, and they render as plain external links.
   */
  resolveCrossWorkspace?: (href: string) => CrossWorkspaceTarget;
  /**
   * Navigates to a document in *another* knowledge base. Surfaces whose
   * `navigate` is scoped to one knowledge base (the Notebook, which selects a
   * node in its own tree) must supply this; when absent, `navigate` is used,
   * which is correct for surfaces that address documents globally.
   */
  navigateCrossWorkspace?: (memoName: string, workspaceName: string, href: string) => void;
}

/**
 * What a cross-workspace href resolved to.
 *
 * - `resolved` — the reader may open the target knowledge base and the path
 *   names a document in it.
 * - `unresolved` — the knowledge base is readable but the path names nothing:
 *   an ordinary broken link.
 * - `unavailable` — the knowledge base does not exist, *or* the reader may not
 *   open it. The server refuses to distinguish these (telling them apart would
 *   reveal which knowledge bases exist), so neither may the UI.
 * - `pending` — the prefetch has not come back yet.
 */
export type CrossWorkspaceTarget =
  | { status: "resolved"; workspaceName: string; workspaceTitle: string; memoName: string }
  | { status: "unresolved" }
  | { status: "unavailable" }
  | { status: "pending" };

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

/** The path form a markdown link destination is written in. Mirrors HrefForm in internal/linkindex/resolve.go. */
export type HrefForm = "absoluteMemo" | "rootRelative" | "relativeExplicit" | "relativeBare" | "workspaceQualified" | "external";

/** Matches a URI scheme prefix ("https:", "mailto:") per RFC 3986. */
const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Decides which path form `href` is written in — the single dispatch point for
 * every renderer, so the precedence between the forms is stated once instead of
 * being re-derived at each call site.
 *
 * Mirrors ClassifyDocHref in internal/linkindex/resolve.go. The shared cases in
 * internal/linkindex/testdata/resolve_cases.json pin the two together; add a
 * case there before changing either side.
 *
 * - "relativeExplicit" (`./x.md`, `../fb/x.md`) is unambiguously a document
 *   reference: not resolving means a broken link.
 * - "relativeBare" (`x.md`, `sub/x.md`) is indistinguishable from a schemeless
 *   external destination such as `example.com/page`, so callers must fall back
 *   to external-link behaviour when it doesn't resolve, NOT show a broken link.
 * - "workspaceQualified" (`@库标题/fb/dc.md`) is the cross-workspace form
 *   (库限定路径). It is decided before the relative forms, so a cross-workspace
 *   reference is never swallowed by in-workspace relative resolution. An "@"
 *   href that does not parse as that form is external, not a document
 *   reference.
 */
export function classifyDocHref(href: string | undefined): HrefForm {
  if (!href) return "external";
  if (isAbsoluteMemoHref(href)) return "absoluteMemo";
  if (href.startsWith("/")) return "rootRelative";
  if (href.startsWith("@")) return parseWorkspaceQualifiedHref(href) ? "workspaceQualified" : "external";
  if (href.startsWith("#") || href.startsWith("?")) return "external";
  if (HAS_SCHEME_RE.test(href)) return "external";
  if (href.startsWith("./") || href.startsWith("../")) return "relativeExplicit";
  return "relativeBare";
}

/** Whether `href` is a document-relative path (文档相对路径), explicit or bare. */
export function isRelativeDocHref(href: string | undefined): href is string {
  const form = classifyDocHref(href);
  return form === "relativeExplicit" || form === "relativeBare";
}

/**
 * Applies `relSegments` to `baseSegments`, resolving "." and "..". Returns
 * undefined when a ".." would climb above the workspace root — a relative path
 * can never address anything outside its own workspace, so cross-workspace
 * document-relative references are structurally impossible rather than merely
 * unsupported.
 */
function normalizeRelativeSegments(baseSegments: string[], relSegments: string[]): string[] | undefined {
  const out = [...baseSegments];
  for (const seg of relSegments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return undefined;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/**
 * Resolves a document-relative href against the folder the *referencing*
 * document lives in (`baseFolderPath`, "" at the workspace root), returning the
 * target memo resource name. Once the segments are normalised, matching is
 * identical to resolveWorkspacePath. There is no fallback.
 *
 * Mirrors ResolveRelativePath in internal/linkindex/resolve.go.
 */
export function resolveRelativePath(tree: WorkspaceTreeNode[], baseFolderPath: string, href: string): string | undefined {
  let path = href;
  try {
    path = decodeURIComponent(href);
  } catch {
    // keep raw href if it isn't valid percent-encoding
  }
  path = path.split(/[?#]/)[0];

  const base = baseFolderPath.split("/").filter((s) => s !== "");
  const rel = path.split("/").filter((s) => s !== "");
  const segments = normalizeRelativeSegments(base, rel);
  if (!segments || segments.length === 0) return undefined;

  const title = stripExt(segments[segments.length - 1]);
  return findDocInFolder(tree, segments.slice(0, -1), title);
}

/**
 * Resolves any in-workspace href form against a workspace tree: the canonical
 * root-relative form, or a document-relative form interpreted against
 * `baseFolderPath` (the folder of the document the markdown came from).
 *
 * This is what a DocumentLinkProvider should supply as its `resolve`, so the
 * dispatch between the forms lives in one place rather than at each provider.
 * Returns undefined for anything that is not an in-workspace document href.
 */
export function resolveInWorkspace(tree: WorkspaceTreeNode[], baseFolderPath: string, href: string): string | undefined {
  switch (classifyDocHref(href)) {
    case "rootRelative":
      return resolveWorkspacePath(tree, href);
    case "relativeExplicit":
    case "relativeBare":
      return resolveRelativePath(tree, baseFolderPath, href);
    default:
      return undefined;
  }
}

/**
 * Splits a workspace-qualified href ("@库标题/fb/dc.md", 库限定路径) into the
 * target workspace title and the root-relative path inside it (leading "/"
 * kept, so it can be handed straight to resolveWorkspacePath). Returns
 * undefined for anything that is not that form.
 *
 * Rejected: an empty title ("@/x.md"), an empty path ("@lib", "@lib/"), and any
 * "." or ".." segment — document-relative navigation is deliberately confined
 * to a single workspace.
 *
 * Mirrors ParseWorkspaceQualifiedHref in internal/linkindex/resolve.go.
 */
export function parseWorkspaceQualifiedHref(href: string | undefined): { title: string; path: string } | undefined {
  if (!href || !href.startsWith("@")) return undefined;
  let rest = href.slice(1);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);

  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  const rawTitle = rest.slice(0, slash);
  const path = rest.slice(slash);

  const segments = path.split("/").filter((s) => s !== "");
  if (segments.length === 0) return undefined;
  if (segments.some((s) => s === "." || s === "..")) return undefined;

  let title = rawTitle;
  try {
    title = decodeURIComponent(rawTitle);
  } catch {
    // keep the raw title if it isn't valid percent-encoding
  }
  if (title.trim() === "") return undefined;
  return { title, path };
}

/** Whether `href` is a well-formed workspace-qualified path (库限定路径). */
export function isWorkspaceQualifiedHref(href: string | undefined): href is string {
  return classifyDocHref(href) === "workspaceQualified";
}

/**
 * Builds a `resolveCrossWorkspace` over the trees prefetched by
 * useCrossWorkspaceTrees, keyed by lower-cased knowledge-base title.
 */
export function makeCrossWorkspaceResolver(
  trees: Map<string, { available: boolean; name: string; title: string; nodes: WorkspaceTreeNode[] }>,
): (href: string) => CrossWorkspaceTarget {
  return (href: string) => {
    const parsed = parseWorkspaceQualifiedHref(href);
    if (!parsed) return { status: "unresolved" };
    const entry = trees.get(parsed.title.trim().toLowerCase());
    if (!entry) return { status: "pending" };
    if (!entry.available) return { status: "unavailable" };
    const memoName = resolveWorkspacePath(entry.nodes, parsed.path);
    if (!memoName) return { status: "unresolved" };
    return { status: "resolved", workspaceName: entry.name, workspaceTitle: entry.title, memoName };
  };
}
