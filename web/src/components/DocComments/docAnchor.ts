import { create } from "@bufbuild/protobuf";
import { type DocAnchor, DocAnchorSchema } from "@/types/proto/api/v1/memo_service_pb";
import { buildTextQuote, resolveTextQuote, type TextQuote } from "./textAnchor";

const HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]";

// Finds the rendered heading nearest above the current scroll position within `container`
// (the document preview's scroll viewport) and returns a DocAnchor for it. When no heading
// sits above the fold (e.g. scrolled to the very top of a doc with no leading heading), the
// returned anchor has empty slug/text, meaning "top of document".
export function nearestHeadingAnchor(container: HTMLElement | null): DocAnchor {
  if (!container) return create(DocAnchorSchema, {});
  const headings = Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  const containerTop = container.getBoundingClientRect().top;
  let current: HTMLElement | undefined;
  for (const heading of headings) {
    // Once a heading sits below the viewport's top edge, every later one does too.
    if (heading.getBoundingClientRect().top - containerTop <= 8) current = heading;
    else break;
  }
  if (!current) return create(DocAnchorSchema, {});
  return create(DocAnchorSchema, { headingSlug: current.id, headingText: (current.textContent ?? "").trim() });
}

// Finds the rendered heading nearest *above a specific DOM node* (e.g. the start of a text
// selection) within `container`, and returns a DocAnchor for it. Used by the selection popover
// so a comment anchors to the section the selected text lives in — independent of scroll
// position. Empty slug/text means the selection is above the first heading ("top of document").
export function nearestHeadingAnchorForNode(container: HTMLElement | null, node: Node | null): DocAnchor {
  if (!container || !node || !container.contains(node)) return create(DocAnchorSchema, {});
  const headings = Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  let current: HTMLElement | undefined;
  for (const heading of headings) {
    // node sits at or after this heading in document order (FOLLOWING covers "node is
    // contained by heading" too, i.e. the selection is inside the heading itself).
    const isBeforeOrAt = (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 || heading.contains(node);
    if (isBeforeOrAt) current = heading;
    else break;
  }
  if (!current) return create(DocAnchorSchema, {});
  return create(DocAnchorSchema, { headingSlug: current.id, headingText: (current.textContent ?? "").trim() });
}

/**
 * Builds a full anchor for a text selection: the enclosing heading (always) plus a quote
 * selector for the selected text (when it covers rendered text), so the comment can render
 * as an in-text mark and still degrade to its section if that text is later rewritten.
 *
 * `color` / `underline` describe how the mark should look; pass an empty color for an
 * underline-only mark. Both are ignored when the selection yields no text quote.
 */
export function buildSelectionAnchor(
  container: HTMLElement | null,
  range: Range,
  style?: { color?: string; underline?: boolean },
): DocAnchor {
  const anchor = nearestHeadingAnchorForNode(container, range.startContainer);
  const quote = container ? buildTextQuote(container, range) : undefined;
  if (!quote) return anchor;
  anchor.textExact = quote.exact;
  anchor.textPrefix = quote.prefix;
  anchor.textSuffix = quote.suffix;
  anchor.color = style?.color ?? "";
  anchor.underline = style?.underline ?? false;
  return anchor;
}

/** The quote selector carried by an anchor, or undefined when it's heading-only. */
export function anchorTextQuote(anchor: DocAnchor | undefined): TextQuote | undefined {
  if (!anchor?.textExact) return undefined;
  return { exact: anchor.textExact, prefix: anchor.textPrefix, suffix: anchor.textSuffix };
}

/**
 * Scrolls to what an anchor points at, preferring its exact text (so the view lands on the
 * marked passage) and falling back to its heading when that text can no longer be found —
 * the same degradation the mark layer applies when it can't draw a mark.
 */
export function scrollToAnchor(scrollContainer: HTMLElement | null, contentContainer: HTMLElement | null, anchor: DocAnchor | undefined) {
  const quote = anchorTextQuote(anchor);
  const range = quote && contentContainer ? resolveTextQuote(contentContainer, quote) : undefined;
  if (range) {
    // A Range has no scrollIntoView; its start element does, and is always on the same line.
    const target = range.startContainer.parentElement;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
  scrollToHeading(scrollContainer, anchor?.headingSlug ?? "");
}

// Scrolls the heading identified by `slug` into view within `container`. No-op when the
// slug is empty (top-of-document anchor) or the heading no longer exists.
export function scrollToHeading(container: HTMLElement | null, slug: string) {
  if (!container) return;
  if (!slug) {
    container.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const target = container.querySelector(`#${CSS.escape(slug)}`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}
