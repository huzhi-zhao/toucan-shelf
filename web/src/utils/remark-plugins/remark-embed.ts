import type { Root, Text } from "mdast";
import type { Node as UnistNode } from "unist";
import { visit } from "unist-util-visit";
import type { EmbedNode, EmbedNodeData } from "@/types/markdown";

// `![[/folder/doc.md]]` embeds another document's rendered body inline. Deliberately not the
// standard `![alt](url)` image syntax — that already means "picture", and overloading it here
// would make "is this a picture or a whole document" depend on the destination's extension.
//
// The brackets in `![[...]]` are themselves CommonMark link/image delimiters. Even though the
// syntax as a whole never resolves to a real link (no destination follows), micromark still
// tracks `[` / `![` as potential openers while parsing and can split the surrounding text into
// several sibling `text` nodes at those bracket positions once the attempt fails. A remark plugin
// that scans one `text` node at a time (the same approach remarkMention and remarkTag use) would
// then see only a fragment of `![[target]]` per node and never match it.
//
// So this can't be a pure post-parse text-node scan like mention/tag. Instead the raw markdown
// string is pre-processed *before* it reaches the parser: `![[target]]` is swapped for a sentinel
// run built entirely from characters with no CommonMark meaning (private-use-area delimiters
// wrapping a percent-encoded target), which is guaranteed to survive inline parsing as a single
// unsplit text node. `remarkEmbed` then only has to find that sentinel.
const RAW_EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const SENTINEL_OPEN = "";
const SENTINEL_CLOSE = "";
const SENTINEL_RE = new RegExp(`${SENTINEL_OPEN}([^${SENTINEL_CLOSE}]*)${SENTINEL_CLOSE}`);

/** Run on the raw markdown string before it is handed to the markdown parser. */
export function substituteEmbedSyntax(markdown: string): string {
  return markdown.replace(
    RAW_EMBED_RE,
    (_match, target: string) => `${SENTINEL_OPEN}${encodeURIComponent(target.trim())}${SENTINEL_CLOSE}`,
  );
}

type Segment = { type: "text"; value: string } | { type: "embed"; value: string };

export function parseEmbedsFromText(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = new RegExp(SENTINEL_RE, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null = re.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    let target = match[1];
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep the raw (already percent-encoded-looking) value if it isn't valid percent-encoding
    }
    segments.push({ type: "embed", value: target });
    lastIndex = re.lastIndex;
    match = re.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function createEmbedNode(target: string): EmbedNode {
  const data: EmbedNodeData = {
    hName: "span",
    hProperties: {
      className: "embed",
      "data-embed-target": target,
    },
    hChildren: [{ type: "text", value: `![[${target}]]` }],
  };

  return {
    type: "embedNode",
    value: target,
    data,
  } as EmbedNode;
}

export const remarkEmbed = () => {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type !== "text" || !parent || index === null) return;

      const textNode = node as Text;
      const segments = parseEmbedsFromText(textNode.value);
      if (segments.every((segment) => segment.type === "text")) {
        return;
      }

      const newNodes = segments.map((segment) => {
        if (segment.type === "embed") {
          return createEmbedNode(segment.value);
        }
        return {
          type: "text",
          value: segment.value,
        } as Text;
      });

      if (typeof index === "number") {
        (parent.children as UnistNode[]).splice(index, 1, ...(newNodes as UnistNode[]));
      }
    });
  };
};
