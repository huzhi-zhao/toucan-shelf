// The site navigation tree, flattened for editing.
//
// The editor shows the tree as an indented list rather than a drag-and-drop
// outline: a row's depth is the only structural thing an author sets, and a flat
// list with an indent control is far less machinery than a tree widget for a
// table of contents that is typed once and rarely reordered.

import type { SiteNavItem } from "@/types/proto/api/v1/site_service_pb";

/** The deepest a row may be indented, matching the server's cap. */
export const MAX_DEPTH = 3;

export interface NavRow {
  depth: number;
  label: string;
  slug: string;
}

/** The tree as a flat list: one row per node, carrying its depth. */
export const flattenNav = (items: SiteNavItem[], depth = 0): NavRow[] =>
  items.flatMap((item) => [{ depth, label: item.label, slug: item.slug }, ...flattenNav(item.children, depth + 1)]);

/**
 * Rows back to a tree. A row deeper than the one above it plus one is treated as
 * a child of that one — an indent the list cannot express is not an error, it is
 * just the nearest tree it does express.
 */
export const nestNav = (rows: NavRow[]): SiteNavItem[] => {
  const root: SiteNavItem[] = [];
  const parents: SiteNavItem[][] = [root];
  for (const row of rows) {
    const depth = Math.min(row.depth, parents.length - 1);
    const node = { label: row.label.trim(), slug: row.slug.trim(), children: [] } as unknown as SiteNavItem;
    parents[depth].push(node);
    parents.length = depth + 1;
    parents.push(node.children);
  }
  return root;
};
