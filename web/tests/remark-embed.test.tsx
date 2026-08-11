import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { SANITIZE_SCHEMA } from "@/components/MemoContent/constants";
import { parseEmbedsFromText, remarkEmbed, substituteEmbedSyntax } from "@/utils/remark-plugins/remark-embed";

describe("substituteEmbedSyntax", () => {
  it("wraps the target in sentinel delimiters, percent-encoded", () => {
    const out = substituteEmbedSyntax("![[/EmbedTestTarget.md]]");
    expect(out).not.toContain("![[");
    expect(out).not.toContain("]]");
    expect(decodeURIComponent(out.replace(/[^\x21-\x7e%]/g, ""))).toBe("/EmbedTestTarget.md");
  });

  it("trims whitespace inside the target", () => {
    const out = substituteEmbedSyntax("![[ /folder/doc.md ]]");
    expect(out.replace(/[^\x21-\x7e%]/g, "")).toBe(encodeURIComponent("/folder/doc.md"));
  });

  it("substitutes multiple embeds independently", () => {
    const out = substituteEmbedSyntax("a ![[/one.md]] b ![[/two.md]] c");
    const segments = parseEmbedsFromText(out);
    expect(segments).toEqual([
      { type: "text", value: "a " },
      { type: "embed", value: "/one.md" },
      { type: "text", value: " b " },
      { type: "embed", value: "/two.md" },
      { type: "text", value: " c" },
    ]);
  });

  it("leaves ordinary image syntax untouched", () => {
    const out = substituteEmbedSyntax("![alt](/pic.png)");
    expect(out).toBe("![alt](/pic.png)");
  });
});

describe("parseEmbedsFromText", () => {
  it("returns a single text segment when there is no embed", () => {
    expect(parseEmbedsFromText("just text")).toEqual([{ type: "text", value: "just text" }]);
  });

  it("decodes percent-encoded targets", () => {
    const sentinel = substituteEmbedSyntax("![[/folder with spaces/doc.md]]");
    expect(parseEmbedsFromText(sentinel)).toEqual([{ type: "embed", value: "/folder with spaces/doc.md" }]);
  });
});

const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkEmbed]} rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}>
      {substituteEmbedSyntax(content)}
    </ReactMarkdown>,
  );

describe("remarkEmbed", () => {
  it("renders `![[target]]` as a span carrying the embed target, surviving sanitization", () => {
    const html = renderMarkdown("![[/EmbedTestTarget.md]]");
    expect(html).toContain('data-embed-target="/EmbedTestTarget.md"');
    expect(html).toMatch(/class="[^"]*\bembed\b[^"]*"/);
  });

  it("does not affect regular markdown image syntax", () => {
    const html = renderMarkdown("![alt text](/pic.png)");
    expect(html).toContain('<img src="/pic.png" alt="alt text"');
    expect(html).not.toContain("data-embed-target");
  });

  it("renders an embed alongside surrounding text in the same paragraph", () => {
    const html = renderMarkdown("before ![[/doc.md]] after");
    expect(html).toContain("before ");
    expect(html).toContain('data-embed-target="/doc.md"');
    expect(html).toContain(" after");
  });

  it("handles two embeds in one paragraph", () => {
    const html = renderMarkdown("![[/one.md]] and ![[/two.md]]");
    expect(html).toContain('data-embed-target="/one.md"');
    expect(html).toContain('data-embed-target="/two.md"');
  });
});
