// Text-level anchoring for document comments.
//
// A document's content is edited freely, so a mark can't be pinned by character offset the
// way an EPUB mark is pinned by CFI (an EPUB file never changes under the reader; a memo's
// markdown does, constantly). Instead a mark stores the text it covers plus a bounded window
// of the text on either side — a "quote selector" — and is re-located by searching the freshly
// rendered document for that quote. Text inserted or deleted elsewhere in the document doesn't
// move the quote relative to its own neighbours, so the mark survives; only rewriting the
// marked passage itself loses it, and callers then fall back to the comment's heading anchor.
//
// All positions here are offsets into the *rendered* text of the preview container (the
// concatenation of its text nodes in document order), never into the markdown source, so the
// same code works for any renderer and never has to reason about markdown syntax.

/** How much surrounding text to keep on each side of a mark, in characters. */
const CONTEXT_LENGTH = 32;

// A short quote ("清单变更", a term, a step number) recurs all over a document, so finding the
// string somewhere is no evidence that it's *this* mark's text: once the marked passage is
// rewritten, a bare string match silently drags the mark onto an unrelated occurrence, which is
// worse than admitting the mark is lost. Short quotes therefore have to bring some of their
// remembered neighbourhood with them to count as located. Long quotes are distinctive enough on
// their own and keep matching on text alone, so re-indenting or re-wording around them is
// harmless.
const SHORT_QUOTE_LENGTH = 12;
const MIN_CONTEXT_SCORE = 4;

/** The text-level part of a DocAnchor: what was marked, and what sat around it. */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

interface TextMap {
  /** Every text node under the container, concatenated in document order. */
  text: string;
  /** Each text node paired with its start offset in `text`. */
  nodes: { node: Text; start: number }[];
}

// Overlay rects are absolutely-positioned siblings of the content, not part of it — walking
// them would corrupt every offset. They're marked with this attribute so we can skip them.
export const MARK_LAYER_ATTR = "data-doc-mark-layer";

// Opts a subtree out of anchoring entirely: its text is neither offered for marking nor searched
// when re-locating one. For content that isn't the document's own prose — a VIEW doc's card
// walls, say, which are live query results whose text appears and vanishes as data changes.
export const MARK_EXCLUDE_ATTR = "data-mark-exclude";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

// Flattens the container's text nodes into one string plus an offset index, so a DOM position
// can be converted to a character offset and back.
const buildTextMap = (container: HTMLElement): TextMap => {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let el = node.parentElement; el && el !== container; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName) || el.hasAttribute(MARK_LAYER_ATTR) || el.hasAttribute(MARK_EXCLUDE_ATTR)) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    nodes.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { text, nodes };
};

// Converts a DOM position (a text node or element plus an offset inside it) to an offset in
// the flattened text. Returns -1 when the position isn't inside any walked text node.
const offsetOfPosition = (map: TextMap, node: Node, offset: number): number => {
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = map.nodes.find((n) => n.node === node);
    return entry ? entry.start + Math.min(offset, entry.node.data.length) : -1;
  }
  // An element position means "before the child at `offset`" — resolve it to the first text
  // node at or after that child, which is where a selection boundary effectively sits.
  const child = node.childNodes[offset];
  if (!child) {
    // Past the last child: fall back to the end of the last text node inside this element.
    for (let i = map.nodes.length - 1; i >= 0; i--) {
      if (node.contains(map.nodes[i].node)) return map.nodes[i].start + map.nodes[i].node.data.length;
    }
    return -1;
  }
  const entry = map.nodes.find((n) => child === n.node || child.contains(n.node));
  return entry ? entry.start : -1;
};

// Converts an offset in the flattened text back to a DOM position.
//
// `edge` decides who owns a boundary that two text nodes share. It matters because the rendered
// document is full of nodes that meet exactly: react-markdown emits a "\n" text node between
// every pair of block elements, and that node's end is the first character of the next block. A
// mark starting at the beginning of a paragraph would otherwise resolve its start to the "\n"
// before it — whose parent is the whole document wrapper, not the paragraph — so anything reading
// `range.startContainer.parentElement` (scrolling to the mark, say) would be pointing at the
// entire document. A start therefore takes the node that genuinely contains the offset, while an
// end takes the node that ends there, so both sit inside the marked text.
const positionOfOffset = (map: TextMap, offset: number, edge: "start" | "end"): { node: Text; offset: number } | undefined => {
  for (const entry of map.nodes) {
    const end = entry.start + entry.node.data.length;
    if (edge === "end" ? offset <= end : offset < end) return { node: entry.node, offset: Math.max(0, offset - entry.start) };
  }
  const last = map.nodes[map.nodes.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : undefined;
};

/**
 * Builds a quote selector for `range` within `container`. Returns undefined when the range
 * covers no rendered text (e.g. it sits entirely inside an overlay or an empty element).
 */
export const buildTextQuote = (container: HTMLElement, range: Range): TextQuote | undefined => {
  const map = buildTextMap(container);
  const start = offsetOfPosition(map, range.startContainer, range.startOffset);
  const end = offsetOfPosition(map, range.endContainer, range.endOffset);
  if (start < 0 || end < 0 || end <= start) return undefined;
  const exact = map.text.slice(start, end);
  if (!exact.trim()) return undefined;
  return {
    exact,
    prefix: map.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: map.text.slice(end, end + CONTEXT_LENGTH),
  };
};

// Scores how well the text around `index` matches the quote's remembered context, by counting
// matching characters inward from the boundary (the characters nearest the mark matter most,
// since those are the least likely to have been edited).
const contextScore = (text: string, index: number, quote: TextQuote): number => {
  let score = 0;
  const before = text.slice(Math.max(0, index - quote.prefix.length), index);
  for (let i = 1; i <= Math.min(before.length, quote.prefix.length); i++) {
    if (before[before.length - i] !== quote.prefix[quote.prefix.length - i]) break;
    score++;
  }
  const afterStart = index + quote.exact.length;
  const after = text.slice(afterStart, afterStart + quote.suffix.length);
  for (let i = 0; i < Math.min(after.length, quote.suffix.length); i++) {
    if (after[i] !== quote.suffix[i]) break;
    score++;
  }
  return score;
};

/**
 * Finds `quote` in the currently rendered `container` and returns a Range over it, or undefined
 * when the marked text is no longer present (the caller should then degrade to the heading
 * anchor). When the text occurs more than once, the occurrence whose surrounding text best
 * matches the remembered prefix/suffix wins, so repeated phrases stay on the right one.
 */
export const resolveTextQuote = (container: HTMLElement, quote: TextQuote): Range | undefined => createQuoteResolver(container)(quote);

/**
 * Builds the container's text map once and returns a resolver over it. Resolving marks one by
 * one via `resolveTextQuote` re-walks the whole document per mark, which on a long document with
 * many marks is quadratic; callers drawing a whole layer should use this instead.
 *
 * The map is a snapshot: only use the returned resolver within a single synchronous measurement
 * pass, before the document can re-render.
 */
export const createQuoteResolver = (container: HTMLElement) => {
  const map = buildTextMap(container);
  return (quote: TextQuote) => resolveInMap(map, quote);
};

const resolveInMap = (map: TextMap, quote: TextQuote): Range | undefined => {
  if (!quote.exact) return undefined;
  let best = -1;
  let bestScore = -1;
  for (let index = map.text.indexOf(quote.exact); index !== -1; index = map.text.indexOf(quote.exact, index + 1)) {
    const score = contextScore(map.text, index, quote);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (best < 0) return undefined;
  // A mark made at the very start or end of a document has little or no remembered context, so
  // the requirement can never exceed what was stored for it.
  const required = Math.min(MIN_CONTEXT_SCORE, quote.prefix.length + quote.suffix.length);
  if (quote.exact.length < SHORT_QUOTE_LENGTH && bestScore < required) return undefined;
  const start = positionOfOffset(map, best, "start");
  const end = positionOfOffset(map, best + quote.exact.length, "end");
  if (!start || !end) return undefined;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};
