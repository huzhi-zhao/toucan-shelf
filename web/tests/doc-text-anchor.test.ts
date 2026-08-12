import { beforeEach, describe, expect, it } from "vitest";
import { buildTextQuote, createQuoteResolver, MARK_EXCLUDE_ATTR, resolveTextQuote } from "@/components/DocComments/textAnchor";

// Builds a container and a Range over `text`'s first occurrence of `target`, the way a user's
// selection would arrive from the browser.
const setup = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
};

// Selects the substring `target` inside the text node at `nodeIndex` (in document order).
const selectIn = (container: HTMLElement, target: string, nodeIndex = 0): Range => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const node = nodes[nodeIndex];
  const start = node.data.indexOf(target);
  if (start < 0) throw new Error(`"${target}" not found in text node ${nodeIndex}`);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + target.length);
  return range;
};

describe("doc text anchors", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("captures the marked text with its surrounding context", () => {
    const container = setup("<p>The quick brown fox jumps over the lazy dog.</p>");
    const quote = buildTextQuote(container, selectIn(container, "brown fox"));

    expect(quote?.exact).toBe("brown fox");
    expect(quote?.prefix).toBe("The quick ");
    expect(quote?.suffix).toBe(" jumps over the lazy dog.");
  });

  it("round-trips: a quote resolves back to the text it was built from", () => {
    const container = setup("<p>alpha beta gamma</p>");
    const quote = buildTextQuote(container, selectIn(container, "beta"));
    const range = resolveTextQuote(container, quote!);

    expect(range?.toString()).toBe("beta");
  });

  it("survives edits elsewhere in the document", () => {
    const container = setup("<p>first paragraph</p><p>the marked sentence</p>");
    const quote = buildTextQuote(container, selectIn(container, "marked", 1));

    // Rewrite an unrelated paragraph and add another — the mark must not move or vanish.
    container.innerHTML = "<p>a completely different opening</p><p>the marked sentence</p><p>and a new trailing one</p>";
    const range = resolveTextQuote(container, quote!);

    expect(range?.toString()).toBe("marked");
    expect(range?.startContainer.parentElement?.textContent).toBe("the marked sentence");
  });

  it("picks the occurrence whose context matches when the phrase repeats", () => {
    const container = setup("<p>alpha target omega</p><p>bravo target zulu</p>");
    const quote = buildTextQuote(container, selectIn(container, "target", 1));
    const range = resolveTextQuote(container, quote!);

    // Both paragraphs contain "target"; the remembered prefix/suffix must select the second.
    expect(range?.startContainer.parentElement?.textContent).toBe("bravo target zulu");
  });

  it("spans across block elements", () => {
    const container = setup("<p>ends here</p><p>starts there</p>");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text;
    const second = walker.nextNode() as Text;
    const range = document.createRange();
    range.setStart(first, 5); // "here"
    range.setEnd(second, 6); // "starts"

    const quote = buildTextQuote(container, range);
    expect(quote?.exact).toBe("herestarts");
    expect(resolveTextQuote(container, quote!)?.toString()).toBe("herestarts");
  });

  // react-markdown separates block elements with literal "\n" text nodes, so a paragraph's first
  // character sits exactly at the end of the whitespace node before it. Resolving the start onto
  // that whitespace node put `range.startContainer.parentElement` at the document wrapper rather
  // than the paragraph — and scrolling "to the mark" then centred the entire document instead.
  it("starts a mark inside its own block, not in the whitespace node before it", () => {
    const container = setup('<h2 id="ch6">6 数据采集</h2>\n<p>Walmart 怀孕故事</p>\n<p>两条金句原则</p>');
    const range = resolveTextQuote(container, { exact: "Walmart 怀孕故事", prefix: "6 数据采集\n", suffix: "\n两条金句原则" });

    expect(range?.toString()).toBe("Walmart 怀孕故事");
    expect(range?.startContainer.parentElement?.tagName).toBe("P");
    expect(range?.endContainer.parentElement?.tagName).toBe("P");
  });

  it("keeps a whole-paragraph mark's ends inside that paragraph", () => {
    const container = setup("<p>first</p>\n<p>the whole marked paragraph</p>\n<p>last</p>");
    const quote = buildTextQuote(container, selectIn(container, "the whole marked paragraph", 2));
    const range = resolveTextQuote(container, quote!);

    expect(range?.toString()).toBe("the whole marked paragraph");
    expect(range?.startContainer.parentElement?.textContent).toBe("the whole marked paragraph");
    expect(range?.endContainer.parentElement?.textContent).toBe("the whole marked paragraph");
  });

  it("reports no match once the marked text itself is rewritten", () => {
    const container = setup("<p>the original wording</p>");
    const quote = buildTextQuote(container, selectIn(container, "original wording"));

    container.innerHTML = "<p>completely rephrased now</p>";

    // The caller degrades to the comment's heading anchor rather than dropping the comment.
    expect(resolveTextQuote(container, quote!)).toBeUndefined();
  });

  it("treats a short quote as lost rather than dragging it onto an unrelated occurrence", () => {
    const container = setup("<p>程序基准：清单变更以申请日为准</p>");
    const quote = buildTextQuote(container, selectIn(container, "清单变更"));

    // The marked sentence is gone; the same short phrase happens to survive somewhere else.
    // Matching on the string alone would silently move the mark there, which reads as "still
    // anchored" while pointing at text the comment was never about.
    container.innerHTML = "<p>附录里偶然提到清单变更这个词。</p>";
    expect(resolveTextQuote(container, quote!)).toBeUndefined();
  });

  it("keeps a long quote anchored even when the text around it was reworded", () => {
    const container = setup("<p>对冲动作：若 2027 年中传出 11.0102 要被移除，我当时还剩哪些动作？</p>");
    const quote = buildTextQuote(container, selectIn(container, "11.0102 要被移除，我当时还剩哪些动作"));

    container.innerHTML = "<p>换了个说法的开场，11.0102 要被移除，我当时还剩哪些动作，以及别的结尾。</p>";
    expect(resolveTextQuote(container, quote!)?.toString()).toBe("11.0102 要被移除，我当时还剩哪些动作");
  });

  it("ignores excluded subtrees on both sides — a VIEW doc's card wall never anchors a mark", () => {
    const container = setup(`<p>prose about widgets</p><div ${MARK_EXCLUDE_ATTR}><span>prose about widgets</span></div>`);
    // A quote taken from the prose must not be able to land in the card wall...
    const quote = buildTextQuote(container, selectIn(container, "about widgets"));
    container.innerHTML = `<div ${MARK_EXCLUDE_ATTR}><span>prose about widgets</span></div>`;
    expect(resolveTextQuote(container, quote!)).toBeUndefined();

    // ...and text selected inside the card wall yields no quote at all.
    const excluded = setup(`<div ${MARK_EXCLUDE_ATTR}><span>card title text</span></div>`);
    expect(buildTextQuote(excluded, selectIn(excluded, "card title"))).toBeUndefined();
  });

  // The mark's own text getting a light copy-edit is the commonest way a mark used to die: an
  // exact-substring search sees a one-character deletion exactly the way it sees a full rewrite.
  it("survives a small edit inside the marked text itself", () => {
    const container = setup("<p>提问：为什么可以用用文档搜索相关性 作为向量化依据？后面还有别的话。</p>");
    const quote = buildTextQuote(container, selectIn(container, "为什么可以用用文档搜索相关性 作为向量化依据？"));

    // The stray 用 is deleted — the only change to the document.
    container.innerHTML = "<p>提问：为什么可以用文档搜索相关性 作为向量化依据？后面还有别的话。</p>";
    expect(resolveTextQuote(container, quote!)?.toString()).toBe("为什么可以用文档搜索相关性 作为向量化依据？");
  });

  it("survives a word inserted into the marked text", () => {
    const container = setup("<p>lead in, the marked sentence about anchoring, trailing words</p>");
    const quote = buildTextQuote(container, selectIn(container, "the marked sentence about anchoring"));

    container.innerHTML = "<p>lead in, the marked sentence really about anchoring, trailing words</p>";
    expect(resolveTextQuote(container, quote!)?.toString()).toBe("the marked sentence really about anchoring");
  });

  it("survives punctuation and whitespace being normalised", () => {
    const container = setup("<p>开头，这是一段被标记的话（含注释），结尾。</p>");
    const quote = buildTextQuote(container, selectIn(container, "这是一段被标记的话（含注释）"));

    // Full-width brackets swapped for half-width ones: the same words to a reader.
    container.innerHTML = "<p>开头，这是一段被标记的话(含注释)，结尾。</p>";
    expect(resolveTextQuote(container, quote!)?.toString()).toBe("这是一段被标记的话(含注释)");
  });

  it("locates the rewritten passage between surviving context when none of it survived", () => {
    const container = setup("<p>the sentence before it. the marked passage in the middle. the sentence after it.</p>");
    const quote = buildTextQuote(container, selectIn(container, "the marked passage in the middle."));

    container.innerHTML = "<p>the sentence before it. an utterly different wording here. the sentence after it.</p>";
    expect(resolveTextQuote(container, quote!)?.toString().trim()).toBe("an utterly different wording here.");
  });

  it("reports how far the passage has drifted, and what it now says", () => {
    const container = setup("<p>lead in, the marked sentence about anchoring, trailing words</p>");
    const quote = buildTextQuote(container, selectIn(container, "the marked sentence about anchoring"));

    // Unedited: found verbatim, so there is nothing to heal.
    expect(createQuoteResolver(container)(quote!)?.confidence).toBe(1);

    container.innerHTML = "<p>lead in, the marked sentence really about anchoring, trailing words</p>";
    const drifted = createQuoteResolver(container)(quote!);
    expect(drifted?.confidence).toBeLessThan(1);
    expect(drifted?.confidence).toBeGreaterThan(0.7);
    // The healed quote describes the passage as it reads now, so writing it back re-bases the
    // anchor and the next edit is measured against the new text rather than the original.
    expect(drifted?.quote.exact).toBe("the marked sentence really about anchoring");
    expect(drifted?.quote.prefix).toBe("lead in, ");
    expect(drifted?.quote.suffix).toBe(", trailing words");
  });

  it("still refuses a passage that was replaced outright", () => {
    const container = setup("<p>the original wording of this particular sentence</p>");
    const quote = buildTextQuote(container, selectIn(container, "the original wording of this particular sentence"));

    container.innerHTML = "<p>a totally unrelated remark about something else entirely</p>";
    expect(resolveTextQuote(container, quote!)).toBeUndefined();
  });

  it("ignores a selection that covers no text", () => {
    const container = setup("<p>   </p>");
    const range = selectIn(container, " ");

    expect(buildTextQuote(container, range)).toBeUndefined();
  });
});
