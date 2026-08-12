// Text-level anchoring for document comments.
//
// A document's content is edited freely, so a mark can't be pinned by character offset the
// way an EPUB mark is pinned by CFI (an EPUB file never changes under the reader; a memo's
// markdown does, constantly). Instead a mark stores the text it covers plus a bounded window
// of the text on either side — a "quote selector" — and is re-located by searching the freshly
// rendered document for that quote. Text inserted or deleted elsewhere in the document doesn't
// move the quote relative to its own neighbours, so the mark survives.
//
// Editing the marked passage *itself* is the hard case, and it is the ordinary one: fixing a typo,
// deleting a stray character, inserting a word. A quote selector that only matches verbatim treats
// a one-character deletion exactly like a full rewrite, so `locate` degrades through progressively
// looser tiers instead and reports how far the passage has drifted — see its comment. Callers use
// that to heal the stored quote forward onto the new text, without which small edits accumulate
// until even the loose tiers can't recognise the passage.
//
// All positions here are offsets into the *rendered* text of the preview container (the
// concatenation of its text nodes in document order), never into the markdown source, so the
// same code works for any renderer and never has to reason about markdown syntax.

/** How much surrounding text to keep on each side of a mark, in characters. */
const CONTEXT_LENGTH = 32;

// Below this length a quote must also agree with its remembered neighbourhood to count as
// located; see the check in `resolveInMap`. Long quotes are distinctive enough on their own.
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

// Scores how well the text around a candidate span matches the quote's remembered context, by
// counting matching characters inward from each boundary (the characters nearest the mark matter
// most, since those are the least likely to have been edited).
const contextScore = (text: string, start: number, end: number, quote: TextQuote): number => {
  let score = 0;
  const before = text.slice(Math.max(0, start - quote.prefix.length), start);
  for (let i = 1; i <= Math.min(before.length, quote.prefix.length); i++) {
    if (before[before.length - i] !== quote.prefix[quote.prefix.length - i]) break;
    score++;
  }
  const after = text.slice(end, end + quote.suffix.length);
  for (let i = 0; i < Math.min(after.length, quote.suffix.length); i++) {
    if (after[i] !== quote.suffix[i]) break;
    score++;
  }
  return score;
};

// ---------------------------------------------------------------------------------------------
// Normalisation
//
// An edit that "didn't change the words" still changes the string: a full-width comma becomes a
// half-width one, a run of spaces collapses, an editor drops a zero-width joiner. Searching a
// normalised copy of the document (with an index back to the original) lets those edits pass
// without the mark noticing, while every offset a mark is finally built from stays an offset into
// the real rendered text.
// ---------------------------------------------------------------------------------------------

// CJK punctuation and its ASCII counterpart read as the same character to a reader, and swapping
// one for the other is one of the commonest edits a Chinese document gets. NFKC does not fold
// these (they're distinct characters, not compatibility forms), so they're listed out.
const PUNCTUATION_FOLD: Record<string, string> = {
  "，": ",",
  "、": ",",
  "。": ".",
  "；": ";",
  "：": ":",
  "？": "?",
  "！": "!",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "《": "<",
  "》": ">",
  "「": '"',
  "」": '"',
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "—": "-",
  "–": "-",
  "～": "~",
  "·": ".",
};

const ZERO_WIDTH = /[​-‍⁠﻿­]/;

interface Normalized {
  text: string;
  /** For each character of `text`, the index in the source string it came from. */
  map: number[];
}

const normalize = (source: string): Normalized => {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ZERO_WIDTH.test(ch)) continue;
    if (/\s/.test(ch)) {
      // A run of whitespace of any kind reads as one break; collapse it so re-wrapping or
      // re-indenting the markdown doesn't detach anything.
      if (text.endsWith(" ")) continue;
      text += " ";
      map.push(i);
      continue;
    }
    const folded = PUNCTUATION_FOLD[ch] ?? ch.normalize("NFKC");
    for (const out of folded) {
      text += out;
      map.push(i);
    }
  }
  return { text, map };
};

/** Maps a span of normalised offsets back onto the source string. */
const toSource = (normalized: Normalized, start: number, end: number, sourceLength: number): [number, number] => {
  if (end <= start) return [-1, -1];
  const from = normalized.map[start];
  const last = normalized.map[end - 1];
  if (from === undefined || last === undefined) return [-1, -1];
  return [from, Math.min(sourceLength, last + 1)];
};

// ---------------------------------------------------------------------------------------------
// Fuzzy location
// ---------------------------------------------------------------------------------------------

/** How similar a candidate passage must be to the remembered text to count as the same passage. */
const MIN_SIMILARITY = 0.7;
/** Levenshtein is quadratic; past this length compare by affix agreement alone. */
const MAX_DISTANCE_LENGTH = 500;

const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
};

const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  if (longest > MAX_DISTANCE_LENGTH) {
    // Too long to diff; agreeing on both ends and on length is evidence enough at this size.
    const shortest = Math.min(a.length, b.length);
    return shortest / longest;
  }
  return 1 - editDistance(a, b) / longest;
};

// The longest prefix of `needle` that still occurs in `haystack`. "Occurs in the haystack" is
// monotone in length (a prefix of a present prefix is present), so this binary-searches.
const longestPresentPrefix = (haystack: string, needle: string): number => {
  let low = 0;
  let high = needle.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (haystack.includes(needle.slice(0, mid))) low = mid;
    else high = mid - 1;
  }
  return low;
};

const longestPresentSuffix = (haystack: string, needle: string): number => {
  let low = 0;
  let high = needle.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (haystack.includes(needle.slice(needle.length - mid))) low = mid;
    else high = mid - 1;
  }
  return low;
};

interface Candidate {
  /** Offsets into the normalised document text. */
  start: number;
  end: number;
  confidence: number;
}

const allIndexesOf = (text: string, needle: string, limit = 64): number[] => {
  const found: number[] = [];
  for (let i = text.indexOf(needle); i !== -1 && found.length < limit; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
};

// Picks the best of several candidate spans: strongest agreement with the remembered text first,
// with the remembered neighbourhood breaking ties (which is what keeps a repeated phrase on its
// own occurrence).
const pickBest = (candidates: Candidate[], text: string, quote: TextQuote): Candidate | undefined => {
  let best: Candidate | undefined;
  let bestKey = -Infinity;
  for (const candidate of candidates) {
    const key = candidate.confidence * 1000 + contextScore(text, candidate.start, candidate.end, quote);
    if (key > bestKey) {
      bestKey = key;
      best = candidate;
    }
  }
  return best;
};

/**
 * Locates the passage a quote was taken from, in a document that has since been edited.
 *
 * Four tiers, each only reached when the ones above it found nothing, and each reporting how much
 * the passage has drifted so the caller can decide whether to trust it (and whether to heal the
 * stored anchor):
 *
 *   1. verbatim — the text is still there character for character.
 *   2. normalised — the same text modulo punctuation width, whitespace and invisibles.
 *   3. affix — the passage's head and/or tail are still there and the middle changed. This is the
 *      tier that survives ordinary copy-editing: deleting a stray character, fixing a typo,
 *      inserting a word. The span between the surviving ends is taken as the passage, and only
 *      accepted if it's still recognisably the remembered text.
 *   4. bracket — none of the passage itself survived, but the text immediately before and after it
 *      did, so the rewritten passage is whatever now sits between them. Reported at low confidence:
 *      it locates the right *place*, not the right words.
 */
const locate = (documentText: string, quote: TextQuote): Candidate | undefined => {
  // 1. Verbatim.
  const verbatim = allIndexesOf(documentText, quote.exact).map((start) => ({
    start,
    end: start + quote.exact.length,
    confidence: 1,
  }));
  if (verbatim.length) return pickBest(verbatim, documentText, quote);

  const doc = normalize(documentText);
  const exact = normalize(quote.exact).text;
  const normalizedQuote: TextQuote = { exact, prefix: normalize(quote.prefix).text, suffix: normalize(quote.suffix).text };
  const toDocument = (candidate: Candidate): Candidate | undefined => {
    const [start, end] = toSource(doc, candidate.start, candidate.end, documentText.length);
    return start < 0 ? undefined : { start, end, confidence: candidate.confidence };
  };
  if (!exact) return undefined;

  // 2. Normalised.
  const normalized = allIndexesOf(doc.text, exact).map((start) => ({ start, end: start + exact.length, confidence: 0.95 }));
  if (normalized.length) {
    const best = pickBest(normalized, doc.text, normalizedQuote);
    return best && toDocument(best);
  }

  // 3. Affix. A surviving head and tail bracket the edited passage directly; when only one end
  // survived it has to carry the passage on its own, so it must be most of it.
  const headLength = longestPresentPrefix(doc.text, exact);
  const tailLength = longestPresentSuffix(doc.text, exact);
  const minAffix = Math.max(4, Math.ceil(exact.length * 0.2));
  const affix: Candidate[] = [];
  const consider = (start: number, end: number) => {
    if (start < 0 || end > doc.text.length || end <= start) return;
    // A span wildly longer or shorter than what was marked is a coincidence, not the passage.
    if (end - start < exact.length * 0.5 || end - start > exact.length * 1.8) return;
    const confidence = similarity(exact, doc.text.slice(start, end));
    if (confidence >= MIN_SIMILARITY) affix.push({ start, end, confidence });
  };
  if (headLength >= minAffix && tailLength >= minAffix) {
    const tail = exact.slice(exact.length - tailLength);
    for (const start of allIndexesOf(doc.text, exact.slice(0, headLength))) {
      // The surviving head and tail may overlap in the document — a deleted character makes one
      // character do the work of two — so the tail is searched from just inside the head rather
      // than from its end. Spans that aren't plausibly the marked passage are rejected on length
      // and similarity below, which is the real guard.
      const tailStart = doc.text.indexOf(tail, start + 1);
      if (tailStart !== -1) consider(start, tailStart + tailLength);
    }
  }
  if (!affix.length && headLength >= exact.length * 0.6) {
    // Head only: the tail was rewritten, so take the remembered length from the head.
    for (const start of allIndexesOf(doc.text, exact.slice(0, headLength))) consider(start, start + exact.length);
  }
  if (!affix.length && tailLength >= exact.length * 0.6) {
    for (const start of allIndexesOf(doc.text, exact.slice(exact.length - tailLength))) {
      consider(start + tailLength - exact.length, start + tailLength);
    }
  }
  if (affix.length) {
    const best = pickBest(affix, doc.text, normalizedQuote);
    return best && toDocument(best);
  }

  // 4. Bracket.
  const before = normalizedQuote.prefix.slice(-BRACKET_CONTEXT);
  const after = normalizedQuote.suffix.slice(0, BRACKET_CONTEXT);
  if (before.length >= MIN_BRACKET_CONTEXT && after.length >= MIN_BRACKET_CONTEXT) {
    const bracket: Candidate[] = [];
    for (const start of allIndexesOf(doc.text, before)) {
      const gapStart = start + before.length;
      const gapEnd = doc.text.indexOf(after, gapStart);
      if (gapEnd === -1) continue;
      const gap = gapEnd - gapStart;
      if (gap <= 0 || gap < exact.length * 0.3 || gap > exact.length * 2.5) continue;
      bracket.push({ start: gapStart, end: gapEnd, confidence: 0.5 });
    }
    if (bracket.length) {
      const best = pickBest(bracket, doc.text, normalizedQuote);
      return best && toDocument(best);
    }
  }
  return undefined;
};

/** How much remembered context the bracket tier uses, and the least it needs on each side. */
const BRACKET_CONTEXT = 16;
const MIN_BRACKET_CONTEXT = 8;

/** A quote located in the document as it currently reads. */
export interface ResolvedQuote {
  range: Range;
  /**
   * How much the passage has drifted: 1 means it was found verbatim, lower means it was located
   * through an edit. Callers use it to decide whether to trust the match and whether the stored
   * anchor is stale enough to be worth healing.
   */
  confidence: number;
  /** The passage as it reads *now*, with fresh context — what a stale anchor should be healed to. */
  quote: TextQuote;
}

/**
 * Finds `quote` in the currently rendered `container` and returns a Range over it, or undefined
 * when the passage can no longer be located at all.
 */
export const resolveTextQuote = (container: HTMLElement, quote: TextQuote): Range | undefined =>
  createQuoteResolver(container)(quote)?.range;

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

const resolveInMap = (map: TextMap, quote: TextQuote): ResolvedQuote | undefined => {
  if (!quote.exact) return undefined;
  const found = locate(map.text, quote);
  if (!found) return undefined;
  // A short quote ("清单变更", a term, a step number) recurs all over a document, so finding it
  // somewhere is no evidence that it's *this* mark's text — it has to bring some of its remembered
  // neighbourhood with it. A mark made at the very start or end of a document has little or no
  // remembered context, so the requirement can never exceed what was stored for it.
  const required = Math.min(MIN_CONTEXT_SCORE, quote.prefix.length + quote.suffix.length);
  if (quote.exact.length < SHORT_QUOTE_LENGTH && contextScore(map.text, found.start, found.end, quote) < required) return undefined;
  const start = positionOfOffset(map, found.start, "start");
  const end = positionOfOffset(map, found.end, "end");
  if (!start || !end) return undefined;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return {
    range,
    confidence: found.confidence,
    quote: {
      exact: map.text.slice(found.start, found.end),
      prefix: map.text.slice(Math.max(0, found.start - CONTEXT_LENGTH), found.start),
      suffix: map.text.slice(found.end, found.end + CONTEXT_LENGTH),
    },
  };
};
