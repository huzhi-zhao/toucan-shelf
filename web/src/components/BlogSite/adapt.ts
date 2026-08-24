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
import type { BlogMenuItem, BlogPost, BlogSiteChrome } from "./types";

export function toBlogPost(page: PublicPage, byline?: string): BlogPost {
  return {
    slug: page.slug,
    // A snapshot can be published from a document with an empty title; the slug
    // is the only thing guaranteed to be there.
    title: page.title || page.slug,
    summary: page.summary || undefined,
    tags: page.tags,
    updatedAt: page.updateTime ? timestampDate(page.updateTime) : undefined,
    byline,
    content: page.content || undefined,
  };
}

/** The path of a published page. Flat: the site's URLs carry no hierarchy. */
export const blogPostPath = (basePath: string, slug: string) => `${basePath}/${slug}`;

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
