import { beforeEach, describe, expect, it } from "vitest";
import { buildTextQuote, resolveTextQuote } from "@/components/DocComments/textAnchor";

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

  it("reports no match once the marked text itself is rewritten", () => {
    const container = setup("<p>the original wording</p>");
    const quote = buildTextQuote(container, selectIn(container, "original wording"));

    container.innerHTML = "<p>completely rephrased now</p>";

    // The caller degrades to the comment's heading anchor rather than dropping the comment.
    expect(resolveTextQuote(container, quote!)).toBeUndefined();
  });

  it("ignores a selection that covers no text", () => {
    const container = setup("<p>   </p>");
    const range = selectIn(container, " ");

    expect(buildTextQuote(container, range)).toBeUndefined();
  });
});
