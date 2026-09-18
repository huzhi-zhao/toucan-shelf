import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { remarkTag } from "@/utils/remark-plugins/remark-tag";

const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkTag]}>{content}</ReactMarkdown>);

describe("remarkTag", () => {
  it("does not turn URL fragments inside autolinks into tags", () => {
    const html = renderMarkdown("https://github.com/dmtrKovalenko/fff#pi-agent-extension\n\n#memo-tag");

    expect(html).toContain('href="https://github.com/dmtrKovalenko/fff#pi-agent-extension"');
    expect(html).not.toContain('data-tag="pi-agent-extension"');
    expect(html).toContain('data-tag="memo-tag"');
  });

  it("does not turn link text or reference link fragments into tags", () => {
    const html = renderMarkdown(
      [
        "[release #notes](https://example.com/releases#release-notes)",
        "[**section #heading**](https://example.com/docs#section-heading)",
        "![preview #image](https://example.com/image#preview)",
        "[reference #anchor][docs]",
        "",
        "[docs]: https://example.com/docs#reference-anchor",
        "",
        "#memo-tag",
      ].join("\n"),
    );

    expect(html).not.toContain('data-tag="notes"');
    expect(html).not.toContain('data-tag="heading"');
    expect(html).not.toContain('data-tag="image"');
    expect(html).not.toContain('data-tag="anchor"');
    expect(html).not.toContain('data-tag="release-notes"');
    expect(html).not.toContain('data-tag="section-heading"');
    expect(html).not.toContain('data-tag="preview"');
    expect(html).not.toContain('data-tag="reference-anchor"');
    expect(html).toContain('data-tag="memo-tag"');
  });

  it("treats formatted inline hashes as prose and tags only the trailing tag line", () => {
    const html = renderMarkdown("**#urgent** and _#later_\n\n#real");

    expect(html).not.toContain('data-tag="urgent"');
    expect(html).not.toContain('data-tag="later"');
    expect(html).toContain('data-tag="real"');
  });

  it("keeps a backslash-escaped hash literal while recognizing a trailing tag line", () => {
    const html = renderMarkdown("\\#NAS is my server\n\n#real");

    // Escaped: rendered as the literal text "#NAS", never a tag pill.
    expect(html).not.toContain('data-tag="NAS"');
    expect(html).toContain("#NAS");
    // An unescaped trailing tag is unaffected.
    expect(html).toContain('data-tag="real"');
  });

  it("leaves a mixed prose line alone even when it contains escaped and unescaped hashes", () => {
    const html = renderMarkdown("\\#first then #second\n\n#third");

    expect(html).not.toContain('data-tag="first"');
    expect(html).not.toContain('data-tag="second"');
    expect(html).toContain("#first");
    expect(html).toContain('data-tag="third"');
  });

  it("tags a whole word containing combining marks", () => {
    // Malayalam കവിത = ka, va, vowel-sign-i (U+0D3F, a spacing combining mark),
    // ta. The vowel sign is a \p{M} character, so the tag must not stop at കവ.
    const html = renderMarkdown("#കവിത");

    expect(html).toContain('data-tag="കവിത"');
    expect(html).not.toContain('data-tag="കവ"');
  });

  it("keeps entity references in prose while recognizing a trailing tag", () => {
    const html = renderMarkdown("Tom &amp; Jerry\n\n#cartoon");

    expect(html).toContain('data-tag="cartoon"');
    expect(html).toContain("Tom &amp; Jerry");
  });
});
