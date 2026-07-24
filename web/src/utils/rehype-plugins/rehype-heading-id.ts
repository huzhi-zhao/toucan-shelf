import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import { headingSlug } from "@/utils/markdown-manipulation";

function getTextContent(node: Element): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "element") {
      text += getTextContent(child);
    }
  }
  return text;
}

interface Options {
  /**
   * Prepended to every heading `id` so ids stay unique across a document made of
   * several independently-rendered markdown snippets (e.g. a gallery View's per-block
   * intro/footer). When set, same-document anchor links (`href="#slug"`) that point at
   * one of these headings are rewritten to the prefixed id so intra-snippet links keep
   * working. Empty (the default, used by normal single-snippet documents) leaves both
   * ids and links untouched — byte-for-byte identical to the un-prefixed behavior.
   */
  prefix?: string;
}

/** Rehype plugin that adds unique slugified `id` attributes to heading elements. */
export const rehypeHeadingId = (options?: Options) => {
  const prefix = options?.prefix ?? "";
  return (tree: Root) => {
    const slugCounts = new Map<string, number>();
    // Maps the un-prefixed slug (what an in-document link's `href="#slug"` targets) to the
    // final, possibly-prefixed id actually assigned to the heading. Only used when prefixing.
    const assigned = new Map<string, string>();

    visit(tree, "element", (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;

      const text = getTextContent(node);
      const slug = headingSlug(text);
      if (!slug) return;

      const count = slugCounts.get(slug) || 0;
      slugCounts.set(slug, count + 1);
      const baseSlug = count > 0 ? `${slug}-${count}` : slug;
      const id = prefix ? `${prefix}-${baseSlug}` : baseSlug;

      node.properties = node.properties || {};
      node.properties.id = id;
      if (prefix) assigned.set(baseSlug, id);
    });

    // Keep intra-snippet anchor links (`[x](#slug)`) working after prefixing the heading ids.
    if (!prefix) return;
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string" || !href.startsWith("#")) return;
      // Match the same way link resolution does: the anchor may be the raw heading text or an
      // already-slugified value, so try the exact fragment then its slug (slugify is idempotent).
      const raw = decodeURIComponent(href.slice(1));
      const mapped = assigned.get(raw) ?? assigned.get(headingSlug(raw));
      if (mapped) node.properties.href = `#${mapped}`;
    });
  };
};
