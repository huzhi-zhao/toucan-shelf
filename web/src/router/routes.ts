export const ROUTES = {
  HOME: "/",
  DASHBOARD: "/dashboard",
  ABOUT: "/about",
  ATTACHMENTS: "/attachments",
  INBOX: "/inbox",
  ARCHIVED: "/archived",
  SHELF: "/shelf",
  SHORTCUTS: "/shortcuts",
  SETTING: "/setting",
  EXPLORE: "/explore",
  AUTH: "/auth",
  SHARED_MEMO: "/memos/shares",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/**
 * URL of a workspace's detail page. Takes the resource name ("workspaces/{uid}")
 * — the same value the API uses — and routes on the bare uid.
 */
export function workspaceDetailPath(workspaceName: string): string {
  return `${ROUTES.SHELF}/${encodeURIComponent(workspaceName.replace(/^workspaces\//, ""))}`;
}
