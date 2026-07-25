import type { ListItem, Paragraph, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

// A click counter list item: `- [N] label`, where N is a non-negative integer.
// GFM only consumes `[ ]` / `[x]` as task markers, so `[1]` survives as literal
// text at the head of the item — exactly like the extended task markers handled
// by remark-task-status. We lift the `[N]` into a `data-counter` property on the
// <li> (and strip it from the text) so the renderer shows a clickable counter
// badge instead of stray brackets; clicking it increments N in the source (see
// Counter.tsx + incrementCounterAtIndex). Runs after remark-gfm.
const COUNTER_MARKER_RE = /^\[(\d+)\](?:[ \t]+|$)/;

function firstTextNode(item: ListItem): { paragraph: Paragraph; text: Text } | undefined {
  const paragraph = item.children[0];
  if (!paragraph || paragraph.type !== "paragraph") return undefined;
  const text = paragraph.children[0];
  if (!text || text.type !== "text") return undefined;
  return { paragraph, text };
}

export const remarkCounter = () => {
  return (tree: Root) => {
    let index = 0;
    visit(tree, "listItem", (item: ListItem) => {
      // A real GFM task (`[ ]` / `[x]`) is never a counter.
      if (typeof item.checked === "boolean") return;

      const head = firstTextNode(item);
      if (!head) return;

      const match = COUNTER_MARKER_RE.exec(head.text.value);
      if (!match) return;

      head.text.value = head.text.value.slice(match[0].length);
      if (head.text.value === "" && head.paragraph.children.length > 1) {
        head.paragraph.children.shift();
      }

      const data = (item.data ??= {});
      const properties = ((data as { hProperties?: Record<string, unknown> }).hProperties ??= {});
      properties["data-counter"] = match[1];
      // Document-order index, so a click can address the matching counter line in
      // the raw markdown (counters never appear in the stripped frontmatter, so
      // this stays in step with incrementCounterAtIndex's scan of memo.content).
      properties["data-counter-index"] = String(index++);
    });
  };
};
