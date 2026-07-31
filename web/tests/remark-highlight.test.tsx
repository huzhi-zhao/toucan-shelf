import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { remarkHighlight } from "@/utils/remark-plugins/remark-highlight";

// `remarkBreaks` matches the real renderer: it turns soft line breaks into
// `break` nodes, which is what splits a multi-line highlight across siblings.
const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkHighlight]}>{content}</ReactMarkdown>);

describe("remarkHighlight", () => {
  it("renders ==text== as a yellow mark", () => {
    const html = renderMarkdown("plain ==yellow== text");

    expect(html).toContain('<mark class="highlight highlight-yellow">yellow</mark>');
  });

  it("renders ===text=== as a pink mark", () => {
    const html = renderMarkdown("plain ===pink=== text");

    expect(html).toContain('<mark class="highlight highlight-pink">pink</mark>');
  });

  it("handles adjacent pairs on the same line", () => {
    const html = renderMarkdown("==a==b==c==");

    expect(html).toContain('<mark class="highlight highlight-yellow">a</mark>b<mark class="highlight highlight-yellow">c</mark>');
  });

  it("does not treat a bare run of = or an empty pair as a highlight", () => {
    const html = renderMarkdown("==== and === alone");

    expect(html).not.toContain("<mark");
    expect(html).toContain("====");
  });

  it("does not highlight inside inline code", () => {
    const html = renderMarkdown("`code ==x==`");

    expect(html).not.toContain("<mark");
    expect(html).toContain("==x==");
  });

  it("spans a soft line break", () => {
    const html = renderMarkdown("==first line\nsecond line==");

    expect(html).toContain('<mark class="highlight highlight-yellow">first line<br/>\nsecond line</mark>');
  });

  it("wraps inline markup the delimiters straddle", () => {
    const html = renderMarkdown("==**quoted**==");

    expect(html).toContain('<mark class="highlight highlight-yellow"><strong>quoted</strong></mark>');
  });

  it("keeps bold inside a highlight that starts and ends with plain text", () => {
    const html = renderMarkdown("==before **bold** after==");

    expect(html).toContain('<mark class="highlight highlight-yellow">before <strong>bold</strong> after</mark>');
  });

  it("highlights inside a list item", () => {
    const html = renderMarkdown("- ==item **with** markup==");

    expect(html).toContain('<mark class="highlight highlight-yellow">item <strong>with</strong> markup</mark>');
  });

  it("tolerates a space before the closing delimiter", () => {
    const html = renderMarkdown("==question? ==");

    expect(html).toContain('<mark class="highlight highlight-yellow">question? </mark>');
  });

  it("does not pair a comparison operator with a later one", () => {
    const html = renderMarkdown("if x == 1 then\ny == 2");

    expect(html).not.toContain("<mark");
  });

  it("does not leak a highlight across paragraphs", () => {
    const html = renderMarkdown("==open here\n\nunrelated paragraph==");

    expect(html).not.toContain("<mark");
  });
});
