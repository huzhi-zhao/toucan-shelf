import { matchPath } from "react-router-dom";
import { ROUTES } from "./routes";

const PROFILE_ROUTE = "/u/:username";
const WORKSPACE_ROUTE = "/:workspaceTitle";
const WORKSPACE_DOC_ROUTE = "/:workspaceTitle/:docId";

// Top-level path segments that are handled by their own static routes rather than
// being a workspace title, so a match against WORKSPACE_ROUTE must exclude them.
// Imported from "./routes" directly (not "@/router") to avoid a circular import
// with router/index.tsx.
const RESERVED_TOP_SEGMENTS = new Set([
  ...Object.values(ROUTES)
    .filter((path) => path !== ROUTES.HOME)
    .map((path) => path.split("/")[1]),
  PROFILE_ROUTE.split("/")[1],
]);

/**
 * True on every route rendered by the Notebook page: its workspace
 * ("/:workspaceTitle") and document ("/:workspaceTitle/:docId") URLs. These own the
 * secondary sidebar (workspace tree), so both the layout chrome and the sidebar
 * toggle must agree on which paths they are. "/" is not one of them — it redirects
 * to the Home page.
 */
export const isNotebookRoute = (pathname: string): boolean => {
  const match = matchPath(WORKSPACE_DOC_ROUTE, pathname) || matchPath(WORKSPACE_ROUTE, pathname);
  return !!match && !RESERVED_TOP_SEGMENTS.has(match.params.workspaceTitle ?? "");
};
