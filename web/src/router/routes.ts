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

/**
 * Platform path of a published site. A site is normally reached at its own
 * domain, where the reader lands on "/" and pages sit at "/<slug>" — but the main
 * application already owns that root segment (":workspaceTitle"), so on the
 * platform host the same site is served under this prefix instead. The snapshot's
 * own links are written as "/<slug>"; the public renderer rebases them onto this
 * prefix (see PublicSiteContext), so the two entry points render identically.
 */
export function publicSitePath(siteName: string): string {
  return `/s/${encodeURIComponent(siteName.replace(/^sites\//, ""))}`;
}

export function publicPagePath(siteName: string, slug: string): string {
  return `${publicSitePath(siteName)}/${slug}`;
}
