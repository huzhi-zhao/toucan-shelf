import type { Blockquote, Paragraph, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { CHAT_FAMILIES, resolveAlertFamily } from "@/components/MemoContent/markdown/alertFamilies";

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
const ALERT_MARKER_RE = /^\[!([A-Za-z][\w:-]*)(?:\(([^)]+)\))?\][ \t]*/;

// Inside a chat blockquote every *line* may open a new bubble, so a whole
// conversation can live in one `>` block without blank lines between turns:
// `[!CHAT:S]` / `[!CHAT:R]`, or the shorthand `[S]` / `[R]`. The sender/time
// caption goes *inside* the brackets — `[!CHAT:R(Lindsay, 08:52)]` — same slot
// every other callout uses for its icon, and the only form accepted: a `(…)`
// after the closing bracket is markdown link syntax, which remark turns into a
// link node before this plugin ever sees the line. Lines without a marker are
// continuation lines of the bubble above them.
const CHAT_LINE_RE = /^\[!?(?:chat:)?([sr])(?:\(([^)]+)\))?\][ \t]*/i;

/** One logical line of a blockquote: paragraph breaks, hard breaks and "\n" inside a text node all end a line. */
type ChatLine = PhrasingContent[];

interface ChatBubble {
  side: "s" | "r";
  time?: string;
  lines: ChatLine[];
}

/**
 * Flattens a blockquote's children into logical lines. Soft line breaks live as
 * "\n" *inside* a single text node (not as separate mdast nodes), so they have
 * to be cut out by hand; `break` nodes and paragraph boundaries end a line too.
 */
function splitChatLines(node: Blockquote): ChatLine[] {
  const lines: ChatLine[] = [];
  let current: ChatLine = [];
  const endLine = () => {
    lines.push(current);
    current = [];
  };

  for (const child of node.children) {
    if (child.type !== "paragraph") {
      // A nested block (list, code, ...) can't be split into lines — keep it whole.
      endLine();
      lines.push([child as unknown as PhrasingContent]);
      continue;
    }
    for (const inline of (child as Paragraph).children) {
      if (inline.type === "break") {
        endLine();
        continue;
      }
      if (inline.type === "text" && inline.value.includes("\n")) {
        inline.value.split("\n").forEach((part, index) => {
          if (index > 0) endLine();
          if (part) current.push({ ...inline, value: part });
        });
        continue;
      }
      current.push(inline);
    }
    endLine();
  }
  endLine();
  return lines.filter((line) => line.length > 0);
}

/** Groups lines into bubbles, opening a new one on every `[!CHAT:X]` / `[X]` marker. */
function collectChatBubbles(lines: ChatLine[], firstSide: "s" | "r", firstTime?: string): ChatBubble[] {
  const bubbles: ChatBubble[] = [];

  for (const line of lines) {
    const head = line[0];
    const match = head.type === "text" ? CHAT_LINE_RE.exec(head.value) : null;
    if (match) {
      const remainder = (head as Text).value.slice(match[0].length);
      const body = remainder ? [{ ...head, value: remainder } as PhrasingContent, ...line.slice(1)] : line.slice(1);
      bubbles.push({ side: match[1].toLowerCase() as "s" | "r", time: match[2], lines: body.length > 0 ? [body] : [] });
    } else if (bubbles.length > 0) {
      bubbles[bubbles.length - 1].lines.push(line);
    } else {
      bubbles.push({ side: firstSide, time: firstTime, lines: [line] });
    }
  }

  return bubbles.filter((bubble) => bubble.lines.length > 0);
}

/** Replaces the transcript blockquote with one blockquote per bubble, and tells `visit` to resume past them. */
function expandChatBubbles(node: Blockquote, parent: Parent, index: number, side: "s" | "r", caption?: string) {
  const bubbles = collectChatBubbles(splitChatLines(node), side, caption);
  if (bubbles.length === 0) {
    return;
  }
  const nodes = toChatNodes(bubbles);
  parent.children.splice(index, 1, ...nodes);
  return [SKIP, index + nodes.length] as [typeof SKIP, number];
}

/** One blockquote per bubble, tagged `data-alert="chat:s" | "chat:r"` for ChatBubble (SpecialCallouts.tsx). */
function toChatNodes(bubbles: ChatBubble[]): RootContent[] {
  return bubbles.map((bubble) => {
    const children: PhrasingContent[] = [];
    bubble.lines.forEach((line, index) => {
      if (index > 0) {
        children.push({ type: "break" });
      }
      children.push(...line);
    });
    return {
      type: "blockquote",
      children: [{ type: "paragraph", children }],
      data: {
        hProperties: {
          "data-alert": `chat:${bubble.side}`,
          ...(bubble.time ? { "data-alert-icon": bubble.time } : {}),
        },
      },
    } satisfies Blockquote;
  });
}

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
    visit(tree, "blockquote", (node: Blockquote, index, parent) => {
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

      // Chat callouts are the one family that expands into *several* nodes: the
      // blockquote is a transcript, and each marked line becomes its own bubble.
      if (CHAT_FAMILIES.has(family) && parent && typeof index === "number") {
        if (remainder) {
          textNode.value = remainder;
        } else {
          paragraph.children.shift();
        }
        return expandChatBubbles(node, parent, index, family === "chat-send" ? "s" : "r", icon);
      }

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
