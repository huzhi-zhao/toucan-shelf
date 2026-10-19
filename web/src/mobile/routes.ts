import { extractMemoIdFromName } from "@/helpers/resource-names";

/**
 * The mobile reader's URLs. It owns its whole host (toucan-app.huzhi.dev), so
 * paths start at the root. The sign-in page sits at `/auth` on purpose: that is
 * where `redirectOnAuthFailure` in `@/connect` sends an expired session, so the
 * shared transport needs no mobile-specific branch. The planner is the home page:
 * `/` (the home-screen app's start URL) goes there.
 */
export const MOBILE_ROUTES = {
  HOME: "/",
  SHELF: "/shelf",
  FAVORITES: "/favorites",
  PLAN: "/plan",
  PLAN_SETTINGS: "/plan/settings",
  PLAN_IMPORT: "/plan/import",
  SEARCH: "/search",
  ME: "/me",
  ME_SETTINGS: "/me/settings",
  AUTH: "/auth",
} as const;

/** `workspaces/{uid}` → `{uid}`. */
export const workspaceUid = (workspaceName: string): string => workspaceName.replace(/^workspaces\//, "");

/** A folder inside a knowledge base; `folderPath` is "" for the root. Each segment is encoded on its own. */
export const folderRoute = (workspaceName: string, folderPath = ""): string => {
  const segments = folderPath.split("/").filter(Boolean).map(encodeURIComponent);
  return ["/kb", encodeURIComponent(workspaceUid(workspaceName)), ...segments].join("/");
};

/** The folder path carried by the splat of `/kb/:uid/*`; already decoded by the router. */
export const folderPathFromSplat = (splat: string | undefined): string => (splat ?? "").split("/").filter(Boolean).join("/");

/** A document by its resource name (`memos/{uid}`). */
export const docRoute = (memoName: string): string => `/doc/${encodeURIComponent(extractMemoIdFromName(memoName))}`;

/** The desktop URL of a document, for "open on a computer". */
export const desktopDocUrl = (memoName: string, origin = DESKTOP_ORIGIN): string => `${origin}/${memoName}`;

/** Where the full web app lives. The mobile host is a separate origin, so links back must be absolute. */
export const DESKTOP_ORIGIN = import.meta.env.VITE_DESKTOP_ORIGIN || "https://toucan.huzhi.dev";

/** A todo's detail page, by its resource name (`planner/todos/{uid}`). */
export const todoRoute = (todoName: string): string => `/plan/todo/${encodeURIComponent(todoName.replace(/^planner\/todos\//, ""))}`;

/** `planner/todos/{uid}` from the detail page's `:uid`. */
export const todoNameFromUid = (uid: string): string => `planner/todos/${uid}`;

/** A "Me" page item's edit page; `new` adds one. */
export const meItemRoute = (id: string): string => `/me/item/${encodeURIComponent(id)}`;

/** The id in `meItemRoute` for an item that does not exist yet. */
export const NEW_ME_ITEM = "new";
