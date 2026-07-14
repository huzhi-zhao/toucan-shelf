import type { Blockquote, Paragraph, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import { resolveAlertFamily } from "@/components/MemoContent/markdown/alertFamilies";

// Families whose custom title behavior must not change: whatever follows the
// `[!TYPE]` marker on the same line stays in the body, as before.
const KEEP_BODY_ONLY_FAMILIES = new Set(["todo", "tip", "quote"]);

// Any `[!WORD]` marker is accepted here — recognition of *which* callout type
// it maps to (and the fallback for unrecognized ones) happens downstream in
// resolveAlertFamily(). This plugin's only job is to detect the marker syntax
// and extract the raw type string.
//
// Matches a leading `[!TYPE]` or `[!TYPE(icon)]` marker at the start of the
// blockquote, e.g. `> [!WARNING]`, `> [!IMPORTANT(✍🏻)] inline body text`, or
// `> [!NOTE]` on its own line followed by more lines. Only the marker itself is
// consumed; whatever follows on the same line (if any) becomes the alert body.
const ALERT_MARKER_RE = /^\[!([A-Za-z][\w-]*)(?:\(([^)]+)\))?\][ \t]*/;

/**
 * Detects Obsidian/GitHub-style alert blockquotes (`> [!NOTE]`, `> [!WARNING(⚠️)]`,
 * `> [!TODO]`, ...) and tags the mdast `blockquote` node with `data.hProperties`
 * so it survives mdast-to-hast unchanged as `data-alert`/`data-alert-icon`
 * attributes on the rendered `<blockquote>` element. Any `[!WORD]` marker is
 * accepted; a blockquote whose first line doesn't match the marker syntax at
 * all is left untouched and renders as a normal blockquote.
 */
export const remarkAlert = () => {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== "paragraph") {
        return;
      }

      const paragraph = firstChild as Paragraph;
      const firstText = paragraph.children[0];
      if (!firstText || firstText.type !== "text") {
        return;
      }

      const textNode = firstText as Text;
      const match = ALERT_MARKER_RE.exec(textNode.value);
      if (!match) {
        return;
      }

      const [, type, icon] = match;
      const remainder = textNode.value.slice(match[0].length);
      const family = resolveAlertFamily(type);
      const keepInBody = KEEP_BODY_ONLY_FAMILIES.has(family);

      let title: string | undefined;
      if (remainder && !keepInBody) {
        // `remainder` may still contain the rest of the blockquote (soft line
        // breaks within a paragraph are just "\n" inside the same text node,
        // not separate mdast nodes) — only the first line becomes the title.
        const newlineIndex = remainder.indexOf("\n");
        if (newlineIndex === -1) {
          title = remainder;
          paragraph.children.shift();
        } else {
          title = remainder.slice(0, newlineIndex);
          const rest = remainder.slice(newlineIndex + 1);
          if (rest) {
            textNode.value = rest;
          } else {
            paragraph.children.shift();
          }
        }
        // Some editors emit an explicit hard-break node between the title line
        // and the body instead of embedding "\n" in the text node — drop it too,
        // otherwise it renders as a blank line above the body.
        if (paragraph.children[0]?.type === "break") {
          paragraph.children.shift();
        }
      } else if (remainder) {
        textNode.value = remainder;
      } else {
        paragraph.children.shift();
      }

      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data as { hProperties?: Record<string, unknown> })?.hProperties,
          "data-alert": type.toLowerCase(),
          ...(icon ? { "data-alert-icon": icon } : {}),
          ...(title ? { "data-alert-title": title } : {}),
        },
      };
    });
  };
};
