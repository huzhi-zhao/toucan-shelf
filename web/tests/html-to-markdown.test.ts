import { describe, expect, it } from "vitest";
import { htmlToMarkdown, looksLikeMarkdown, shouldConvertHtml } from "@/utils/html-to-markdown";

// Fixtures are trimmed-down but structurally faithful copies of what Chrome puts on the
// clipboard when copying from these sources.

describe("shouldConvertHtml", () => {
  it("converts a web page selection", () => {
    expect(shouldConvertHtml("<h1>Title</h1><p>body</p>", "Title\nbody")).toBe(true);
  });

  it("skips when the plain flavor is already markdown", () => {
    const plain = "## Setup\n\n```bash\npnpm install\n```";
    expect(shouldConvertHtml("<h2>Setup</h2><pre><code>pnpm install</code></pre>", plain)).toBe(false);
  });

  it("skips html without structure", () => {
    expect(shouldConvertHtml("<div>just a sentence</div>", "just a sentence")).toBe(false);
  });

  it("skips an empty html flavor", () => {
    expect(shouldConvertHtml("", "plain only")).toBe(false);
  });

  it("recognizes markdown by list, table, quote and link syntax", () => {
    expect(looksLikeMarkdown("- one\n- two")).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(looksLikeMarkdown("> quoted")).toBe(true);
    expect(looksLikeMarkdown("see [docs](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("1. one\n2. two")).toBe(true);
    expect(looksLikeMarkdown("An ordinary sentence - with a dash.")).toBe(false);
  });
});

describe("htmlToMarkdown", () => {
  it("maps headings, emphasis, lists and links", async () => {
    const html = `
      <h2>Install</h2>
      <p>Run <strong>pnpm</strong> with <em>node 24</em>.</p>
      <ul><li>first</li><li>second</li></ul>
      <p><a href="https://example.com/docs">Docs</a></p>`;
    expect(await htmlToMarkdown(html)).toBe(
      ["## Install", "", "Run **pnpm** with *node 24*.", "", "- first", "- second", "", "[Docs](https://example.com/docs)"].join("\n"),
    );
  });

  it("keeps gfm tables, strikethrough and task lists", async () => {
    const html = `
      <table><thead><tr><th>Key</th><th>Value</th></tr></thead>
      <tbody><tr><td>a</td><td>1</td></tr></tbody></table>
      <p><del>dropped</del></p>
      <ul><li><input type="checkbox" checked>done</li></ul>`;
    const markdown = await htmlToMarkdown(html);
    expect(markdown).toContain("| Key | Value |");
    expect(markdown).toContain("| a | 1 |");
    expect(markdown).toContain("~dropped~");
    expect(markdown).toContain("- [x] done");
  });

  it("recovers the code block language", async () => {
    const fromClass = await htmlToMarkdown('<pre><code class="language-go">func main() {}</code></pre>');
    expect(fromClass).toBe("```go\nfunc main() {}\n```");

    const fromDataAttr = await htmlToMarkdown('<div data-language="python"><pre><code>print(1)</code></pre></div>');
    expect(fromDataAttr).toBe("```python\nprint(1)\n```");

    const unknown = await htmlToMarkdown("<pre><code>plain</code></pre>");
    expect(unknown).toBe("```\nplain\n```");
  });

  it("does not escape markdown syntax inside code blocks", async () => {
    const markdown = await htmlToMarkdown('<pre><code class="language-md"># title *bold* _x_</code></pre>');
    expect(markdown).toBe("```md\n# title *bold* _x_\n```");
  });

  it("widens the fence when the code contains backticks", async () => {
    const markdown = await htmlToMarkdown("<pre><code>a ``` b</code></pre>");
    expect(markdown).toBe("````\na ``` b\n````");
  });

  it("pulls the original TeX out of KaTeX output", async () => {
    const inline = `<p>where
      <span class="katex"><span class="katex-mathml"><math><semantics>
      <annotation encoding="application/x-tex">a^2 + b_1</annotation>
      </semantics></math></span><span class="katex-html"><span class="mord">a</span></span></span>
      holds.</p>`;
    expect(await htmlToMarkdown(inline)).toBe("where $a^2 + b_1$ holds.");

    const display = `<span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics>
      <annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation>
      </semantics></math></span><span class="katex-html">glyphs</span></span></span>`;
    expect(await htmlToMarkdown(display)).toBe("$$\n\\int_0^1 x\\,dx\n$$");
  });

  it("drops math it cannot recover TeX from", async () => {
    const html = "<p>see <math><mi>x</mi></math> here</p>";
    expect(await htmlToMarkdown(html)).toBe("see here");
  });

  it("strips Office paste wrappers", async () => {
    const html = `<p class="MsoNormal" style="mso-margin-top-alt:auto">
      <span lang="EN-US" style="mso-bidi-font-size:11.0pt">Quarterly&nbsp;report</span><o:p></o:p></p>`;
    expect(await htmlToMarkdown(html)).toBe("Quarterly report");
  });

  it("drops relative images and de-links relative hrefs", async () => {
    const html = '<p><img src="/img/logo.png" alt="logo"><a href="/docs/intro">Intro</a></p>';
    expect(await htmlToMarkdown(html)).toBe("Intro");
  });

  it("keeps absolute images and links", async () => {
    const html = '<p><img src="https://cdn.example.com/a.png" alt="a"> <a href="mailto:x@example.com">mail</a></p>';
    const markdown = await htmlToMarkdown(html);
    expect(markdown).toContain("![a](https://cdn.example.com/a.png)");
    expect(markdown).toContain("[mail](mailto:x@example.com)");
  });

  it("keeps paragraph boundaries from div-based layouts", async () => {
    const html = "<div><div>first paragraph</div><div>second paragraph</div></div>";
    expect(await htmlToMarkdown(html)).toBe("first paragraph\n\nsecond paragraph");
  });

  it("ignores scripts, styles and zero-width padding", async () => {
    const html = "<style>p{color:red}</style><script>alert(1)</script><p>vis​ible</p>";
    expect(await htmlToMarkdown(html)).toBe("visible");
  });
});
