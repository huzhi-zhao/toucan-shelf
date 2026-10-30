import type { Element, ElementContent } from "hast";
import { ChevronRightIcon } from "lucide-react";
import { Children, cloneElement, createContext, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";

/**
 * How a document's bullet lists render (`DocConfig.bulletListStyle`). New styles are added here as new names,
 * each drawn by its own branch in `List`.
 */
export type BulletListStyleName = "plain" | "cards";

export const BulletListStyleContext = createContext<BulletListStyleName>("plain");

/** Whether the list item being rendered is a direct item of a card list (a nested list resets it). */
export const CardItemContext = createContext(false);

/** The card a top-level bullet list becomes in the "cards" style: one rounded card, its items rows. */
export const CARD_LIST_CLASS = "my-3 list-none overflow-hidden rounded-2xl border border-border bg-card p-0";

// Solid squares for the items without an emoji, picked from the item's text so it keeps its color.
const SQUARE_COLORS = [
  "bg-purple-600",
  "bg-rose-700",
  "bg-green-700",
  "bg-teal-700",
  "bg-red-600",
  "bg-yellow-500",
  "bg-blue-600",
  "bg-orange-500",
];

const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;

const isListElement = (node: ElementContent) => node.type === "element" && (node.tagName === "ul" || node.tagName === "ol");

const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" && !isListElement(node) ? node.children.map(textOf).join("") : "";

const hasLink = (node: ElementContent): boolean =>
  node.type === "element" && !isListElement(node) && (node.tagName === "a" || node.children.some(hasLink));

const isNestedList = (child: ReactNode) =>
  isValidElement<{ node?: Element }>(child) && (child.props.node?.tagName === "ul" || child.props.node?.tagName === "ol");

/**
 * Takes the item's leading emoji off its first text: it becomes the icon in the row's square. The text sits
 * directly in the item (a tight list) or in its first paragraph (a loose one).
 */
function splitLeadingEmoji(children: ReactNode[]): { emoji?: string; rest: ReactNode[] } {
  const index = children.findIndex((child) => !(typeof child === "string" && child.trim() === ""));
  const first = children[index];
  if (typeof first === "string") {
    const match = first.match(LEADING_EMOJI);
    if (!match) return { rest: children };
    return { emoji: match[1], rest: children.map((child, i) => (i === index ? first.slice(match[0].length) : child)) };
  }
  if (isValidElement<{ children?: ReactNode }>(first) && first.type !== "ul" && first.type !== "ol") {
    const inner = splitLeadingEmoji(Children.toArray(first.props.children));
    if (!inner.emoji) return { rest: children };
    return {
      emoji: inner.emoji,
      rest: children.map((child, i) =>
        i === index ? cloneElement(first as ReactElement<{ children?: ReactNode }>, undefined, ...inner.rest) : child,
      ),
    };
  }
  return { rest: children };
}

/**
 * One item of a card list: a square on the left (the item's leading emoji, else a color), its text, and a
 * chevron when it links somewhere, the whole row then following its link. A nested list stays a plain list
 * under the text.
 */
export function CardListItem({ node, children, className }: { node?: Element; children: ReactNode; className?: string }) {
  const all = Children.toArray(children);
  const nested = all.filter(isNestedList);
  const { emoji, rest } = splitLeadingEmoji(all.filter((child) => !isNestedList(child)));
  const linked = node ? node.children.some(hasLink) : false;
  const text = node ? node.children.map(textOf).join("").trim() : "";
  const color = SQUARE_COLORS[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % SQUARE_COLORS.length];

  return (
    <li
      className={cn(
        "relative m-0 flex items-center gap-3 px-4 py-3",
        // A hairline under every row but the last, starting where the text does (16px + 36px square + 12px gap).
        "after:absolute after:bottom-0 after:left-16 after:right-0 after:h-px after:bg-border last:after:hidden",
        linked && "hover:bg-accent/50 active:bg-accent",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg text-xl leading-none", !emoji && color)}
      >
        {emoji}
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 text-[17px] [&_p]:m-0",
          // The row follows its link: the link's box is stretched over the whole row.
          linked && "[&_a]:no-underline [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:content-['']",
        )}
      >
        <NestedMarkdownRenderContext>
          {rest}
          {nested.length > 0 && <div className="relative z-10">{nested}</div>}
        </NestedMarkdownRenderContext>
      </div>
      {linked && <ChevronRightIcon aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />}
    </li>
  );
}
