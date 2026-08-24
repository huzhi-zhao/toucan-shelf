import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Marks a subtree as rendering a published snapshot for an anonymous reader.
 *
 * The renderer is shared with the app on purpose — a published page has to look
 * like the document it came from — but a few of its behaviours only make sense
 * inside the knowledge base and would either dead-end or leak on a public site:
 * a tag click filters a memo list the reader has no access to, and an in-site
 * link is written as "/<slug>", which resolves only when the site owns the root
 * of the URL space.
 *
 * `basePath` is what the second one needs: on a custom domain the site does own
 * the root and this is "", while on the platform path the same site is served
 * under "/s/{site}" and every in-site link has to be rebased onto it.
 */
export interface PublicSiteRenderContextValue {
  /** Prefix in-site links are rebased onto. "" when the site owns the URL root. */
  basePath: string;
}

const PublicSiteRenderContext = createContext<PublicSiteRenderContextValue | null>(null);

export const PublicSiteRenderProvider = ({ basePath, children }: { basePath: string; children: ReactNode }) => {
  const value = useMemo(() => ({ basePath }), [basePath]);
  return <PublicSiteRenderContext.Provider value={value}>{children}</PublicSiteRenderContext.Provider>;
};

export const usePublicSiteRender = (): PublicSiteRenderContextValue | null => useContext(PublicSiteRenderContext);

/**
 * Whether an href is a link within the published site. Snapshot bodies carry
 * in-site document links as "/<slug>" and attachment links as "/file/…"; anything
 * scheme-qualified or protocol-relative is an outside link and stays one.
 */
export const isInSiteHref = (href: string | undefined): href is string => Boolean(href) && href!.startsWith("/") && !href!.startsWith("//");
