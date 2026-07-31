import type { Root, Text } from "mdast";
import type { Node as UnistNode } from "unist";

// Obsidian-style highlight syntax: `==text==` for a yellow background,
// `===text===` (this project's own extension, not part of Obsidian) for pink.
// Delimiters must be immediately followed/preceded by non-`=` content — an
// empty pair (`====`) or a run of bare `=` characters never opens a highlight.
//
// A highlight is matched across the *inline siblings* of one block, not just
// inside a single text node, so the delimiters may sit on either side of other
// inline markup or of a soft line break:
//
//   ==前半句。\n后半句。==        (remark-breaks turned the newline into a `break`)
//   ==**加粗的引文**==            (the `==` pair straddles a `strong` node)
//   ==普通 **加粗** 普通==
//
// The produced node keeps real mdast children, so whatever the highlight wraps
// (emphasis, links, breaks, …) still renders inside the `<mark>`.

type Color = "yellow" | "pink";

type ParentNode = UnistNode & { children: UnistNode[] };

function isParentNode(node: UnistNode): node is ParentNode {
  return Array.isArray((node as { children?: unknown }).children);
}

function isTextNode(node: UnistNode): node is Text {
  return node.type === "text" && typeof (node as Text).value === "string";
}

/**
 * The delimiter that opens at `index`, if any. At most one can match: the
 * longer `===` is only a candidate when the third `=` is present, which is
 * exactly the case where `==` is rejected for being followed by another `=`.
 * A position in the middle of a longer `=` run never opens a highlight.
 *
 * The opener must hug its content: a delimiter followed by whitespace is prose,
 * not markup (`if x == 1`), and since highlights now span siblings such a stray
 * `==` would otherwise pair with an unrelated one further down the block.
 * Running out of text is fine — that is the `==**bold**==` shape, where the
 * opening text node ends at the delimiter.
 */
function openerAt(text: string, index: number): { seq: string; color: Color } | undefined {
  if (text[index] !== "=" || (index > 0 && text[index - 1] === "=")) {
    return undefined;
  }

  const opener =
    text.startsWith("===", index) && text[index + 3] !== "="
      ? ({ seq: "===", color: "pink" } as const)
      : text.startsWith("==", index) && text[index + 2] !== "="
        ? ({ seq: "==", color: "yellow" } as const)
        : undefined;
  if (!opener) {
    return undefined;
  }

  const next = text[index + opener.seq.length];
  return next !== undefined && /\s/.test(next) ? undefined : opener;
}

/**
 * The first `seq` at or after `from` that closes a highlight: it must not be
 * followed by another `=` (i.e. it is not the head of a longer closing run).
 */
function closerAt(text: string, from: number, seq: string): number {
  let at = text.indexOf(seq, from);
  while (at !== -1) {
    if (text[at + seq.length] !== "=") {
      return at;
    }
    at = text.indexOf(seq, at + 1);
  }
  return -1;
}

function textNode(value: string): Text {
  return { type: "text", value } as Text;
}

function createHighlightNode(color: Color, children: UnistNode[]): ParentNode {
  return {
    type: "highlight",
    children,
    data: {
      hName: "mark",
      hProperties: { className: `highlight highlight-${color}` },
    },
  } as unknown as ParentNode;
}

/** Where a highlight's closing delimiter was found, relative to the opening text node. */
type Closer = { kind: "same-node"; at: number } | { kind: "sibling"; siblingIndex: number; at: number };

/**
 * Look for the closing delimiter, first in the rest of the opening text node,
 * then in the following inline siblings' text nodes. Only direct siblings are
 * searched: a delimiter buried inside another inline node (a link's label, a
 * code span) is left alone, so `==` never half-swallows nested markup.
 */
function findCloser(children: UnistNode[], nodeIndex: number, contentStart: number, seq: string): Closer | undefined {
  const openingText = (children[nodeIndex] as Text).value;

  // Within the opening node the content must be non-empty, otherwise `====`
  // and friends would pair with themselves.
  const sameNode = closerAt(openingText, contentStart, seq);
  if (sameNode > contentStart) {
    return { kind: "same-node", at: sameNode };
  }

  for (let sibling = nodeIndex + 1; sibling < children.length; sibling++) {
    const node = children[sibling];
    if (!isTextNode(node)) {
      continue;
    }
    const at = closerAt(node.value, 0, seq);
    if (at !== -1) {
      return { kind: "sibling", siblingIndex: sibling, at };
    }
  }

  return undefined;
}

/**
 * Try to build one highlight starting somewhere inside `children[nodeIndex]`
 * (a text node). Returns the index to resume scanning from, or `undefined` when
 * the node holds no highlight at all.
 */
function highlightFrom(parent: ParentNode, nodeIndex: number): number | undefined {
  const children = parent.children;
  const text = (children[nodeIndex] as Text).value;

  for (let i = 0; i < text.length; i++) {
    const opener = openerAt(text, i);
    if (!opener) {
      continue;
    }

    const contentStart = i + opener.seq.length;
    const closer = findCloser(children, nodeIndex, contentStart, opener.seq);
    if (!closer) {
      continue;
    }

    const before = text.slice(0, i);
    const replacement: UnistNode[] = [];
    if (before !== "") {
      replacement.push(textNode(before));
    }

    if (closer.kind === "same-node") {
      const inner = text.slice(contentStart, closer.at);
      const after = text.slice(closer.at + opener.seq.length);
      replacement.push(createHighlightNode(opener.color, [textNode(inner)]));

      const markIndex = replacement.length - 1;
      if (after !== "") {
        replacement.push(textNode(after));
      }
      children.splice(nodeIndex, 1, ...replacement);
      // Resume on the trailing text so a second highlight on the same line is
      // still found; otherwise continue after the mark we just produced.
      return nodeIndex + (after !== "" ? markIndex + 1 : replacement.length);
    }

    const closingNode = children[closer.siblingIndex] as Text;
    const head = text.slice(contentStart);
    const tail = closingNode.value.slice(0, closer.at);
    const after = closingNode.value.slice(closer.at + opener.seq.length);

    const inner: UnistNode[] = [];
    if (head !== "") {
      inner.push(textNode(head));
    }
    inner.push(...children.slice(nodeIndex + 1, closer.siblingIndex));
    if (tail !== "") {
      inner.push(textNode(tail));
    }

    const mark = createHighlightNode(opener.color, inner);
    transformHighlights(mark);
    replacement.push(mark);

    const markIndex = replacement.length - 1;
    if (after !== "") {
      replacement.push(textNode(after));
    }
    children.splice(nodeIndex, closer.siblingIndex - nodeIndex + 1, ...replacement);
    return nodeIndex + (after !== "" ? markIndex + 1 : replacement.length);
  }

  return undefined;
}

function transformHighlights(parent: ParentNode): void {
  let index = 0;

  while (index < parent.children.length) {
    const child = parent.children[index];

    if (isTextNode(child)) {
      const next = highlightFrom(parent, index);
      index = next ?? index + 1;
      continue;
    }

    if (isParentNode(child)) {
      transformHighlights(child);
    }
    index++;
  }
}

export const remarkHighlight = () => {
  return (tree: Root) => {
    transformHighlights(tree as unknown as ParentNode);
  };
};
