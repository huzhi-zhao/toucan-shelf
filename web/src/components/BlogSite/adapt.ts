/**
 * Wire types → view models.
 *
 * The skin components take plain objects, never `PublicPage`, so this file is
 * the only place that knows the shape of the API. That is what lets the same
 * components render a live site and a fixture, and it is where wiring real data
 * in happens — the components themselves do not change.
 */

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { CSSProperties } from "react";
import type { PublicPage, PublicSiteProfile } from "@/types/proto/api/v1/public_site_service_pb";
import type { SiteNavItem } from "@/types/proto/api/v1/site_service_pb";
import type { BlogMenuItem, BlogNavNode, BlogPost, BlogSiteChrome } from "./types";

export function toBlogPost(page: PublicPage, byline?: string): BlogPost {
  return {
    slug: page.slug,
    // A snapshot can be published from a document with an empty title; the slug
    // is the only thing guaranteed to be there.
    title: page.title || page.slug,
    summary: page.summary || undefined,
    tags: page.tags,
    // Frozen with the snapshot, never re-derived from the source document.
    coverUrl: page.coverUrl || undefined,
    updatedAt: page.updateTime ? timestampDate(page.updateTime) : undefined,
    byline,
    content: page.content || undefined,
  };
}

/**
 * The name a page is attributed to.
 *
 * The server already resolves this (author name, falling back to the site's own
 * name), so the fallback repeated here is only for a profile served by an older
 * server — not a second opinion about what the byline should be.
 */
export const siteByline = (profile: PublicSiteProfile) => profile.authorName || profile.displayName;

/** The path of a published page. Flat: the site's URLs carry no hierarchy. */
export const blogPostPath = (basePath: string, slug: string) => `${basePath}/${slug}`;

/**
 * The navigation tree as the skin renders it.
 *
 * The server has already pruned it to what is published: a node pointing at a
 * page that is not published on this site arrives here with an empty slug, and
 * one with nothing left under it does not arrive at all. So there is no "is this
 * link dead" check to make out here — the pruning is what keeps the tree from
 * naming a document a reader cannot open.
 */
export const toBlogNav = (nav: SiteNavItem[]): BlogNavNode[] =>
  nav.map((node) => ({
    label: node.label,
    slug: node.slug || undefined,
    children: node.children.length > 0 ? toBlogNav(node.children) : undefined,
  }));

export function toBlogChrome(profile: PublicSiteProfile): BlogSiteChrome {
  const menu: BlogMenuItem[] = profile.menu.map((item) => ({ label: item.label, to: item.path }));
  return {
    name: profile.displayName,
    description: profile.description || undefined,
    // The search entry is one of the menu entries, so a site that removed it has
    // removed it everywhere. P3 wires the page itself.
    showSearch: menu.some((item) => item.to === "search"),
    menu: menu.filter((item) => item.to !== "search"),
  };
}

/**
 * The site's theme as inline custom properties.
 *
 * The server has already rejected anything that is not a whitelisted key with a
 * value of that key's shape; the filter here is the cheap second half of that —
 * an unknown key reaching this far means the two lists have drifted, and the
 * right outcome is that it does not render, not that it is written out.
 */
const THEME_KEYS = new Set([
  "bg",
  "surface",
  "ink",
  "ink-soft",
  "ink-muted",
  "hairline",
  "accent",
  "accent-soft",
  "font-display",
  "font-body",
  "cover-radius",
  "shell-max",
  "gutter",
  "prose-max",
]);

export function toBlogThemeStyle(theme: string): CSSProperties {
  if (!theme.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(theme);
  } catch {
    // A site whose theme will not parse renders in the default one. The home
    // page of a site is not the place to show a stack trace.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (THEME_KEYS.has(key) && typeof value === "string") {
      style[`--blog-${key}`] = value;
    }
  }
  return style as CSSProperties;
}
