import type { Blockquote, Paragraph, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

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

      if (remainder) {
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
        },
      };
    });
  };
};
