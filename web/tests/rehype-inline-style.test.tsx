import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { SANITIZE_SCHEMA } from "@/components/MemoContent/constants";
import { rehypeInlineStyle, sanitizeInlineStyle } from "@/utils/rehype-plugins/rehype-inline-style";

describe("sanitizeInlineStyle", () => {
  it("keeps whitelisted typographic properties", () => {
    expect(sanitizeInlineStyle("color: #2c3e50; font-size: 3em; text-align: center")).toBe(
      "color: #2c3e50; font-size: 3em; text-align: center",
    );
  });

  it("keeps longhand members of the allowed families", () => {
    expect(sanitizeInlineStyle("margin-top: 4px; padding-left: 1em; border-bottom-color: red")).toBe(
      "margin-top: 4px; padding-left: 1em; border-bottom-color: red",
    );
  });

  it("drops out-of-flow properties that enable UI redressing", () => {
    expect(sanitizeInlineStyle("position: fixed; top: 0; left: 0; z-index: 99999; color: red")).toBe("color: red");
  });

  it("drops pointer-events, opacity and transform even alongside allowed properties", () => {
    expect(sanitizeInlineStyle("pointer-events: none; opacity: 0; transform: scale(9); font-weight: bold")).toBe("font-weight: bold");
  });

  it("rejects any declaration whose value can trigger a network request", () => {
    expect(sanitizeInlineStyle("background-color: url(https://attacker.example/ping)")).toBe("");
    expect(sanitizeInlineStyle("font-family: url('https://attacker.example/f.woff')")).toBe("");
    expect(sanitizeInlineStyle("border: 1px solid red; background-color: URL( https://attacker.example )")).toBe("border: 1px solid red");
  });

  it("rejects legacy and injection-flavored values", () => {
    expect(sanitizeInlineStyle("width: expression(alert(1))")).toBe("");
    expect(sanitizeInlineStyle("color: javascript:alert(1)")).toBe("");
    expect(sanitizeInlineStyle("@import 'https://attacker.example/x.css'; color: red")).toBe("color: red");
  });

  it("cannot be smuggled past the value checks with comments", () => {
    expect(sanitizeInlineStyle("background-color: u/**/rl(https://attacker.example)")).toBe("");
    expect(sanitizeInlineStyle("/* color: red */ position: fixed")).toBe("");
  });

  it("allows display only for in-flow values, never none", () => {
    expect(sanitizeInlineStyle("display: inline-block")).toBe("display: inline-block");
    expect(sanitizeInlineStyle("display: none")).toBe("");
    expect(sanitizeInlineStyle("display: fixed")).toBe("");
  });

  it("drops custom properties, which would route around the property allow-list", () => {
    expect(sanitizeInlineStyle("--evil: fixed; color: red")).toBe("color: red");
  });

  it("does not split a quoted value containing a semicolon", () => {
    expect(sanitizeInlineStyle('font-family: "Fira; Code", monospace')).toBe('font-family: "Fira; Code", monospace');
  });

  it("keeps text-shadow, including its rgba() parentheses", () => {
    expect(sanitizeInlineStyle("text-shadow: 1px 1px 2px rgba(0,0,0,0.2)")).toBe("text-shadow: 1px 1px 2px rgba(0,0,0,0.2)");
  });

  it("strips !important without rejecting the declaration", () => {
    expect(sanitizeInlineStyle("color: red !important")).toBe("color: red");
  });

  it("returns empty for malformed or fully-rejected input", () => {
    expect(sanitizeInlineStyle("")).toBe("");
    expect(sanitizeInlineStyle(";;;")).toBe("");
    expect(sanitizeInlineStyle("color")).toBe("");
    expect(sanitizeInlineStyle("color:")).toBe("");
  });
});

const render = (content: string): string =>
  renderToStaticMarkup(
    <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeInlineStyle, [rehypeSanitize, SANITIZE_SCHEMA]]}>{content}</ReactMarkdown>,
  );

describe("rehypeInlineStyle in the render pipeline", () => {
  it("renders a Quartz-style decorated heading with its typography intact", () => {
    const html = render(
      '<h1 style="text-align: center; font-size: 3em; color: #2c3e50; border-top: 4px solid #3498db; letter-spacing: 3px;">NLP 入门</h1>',
    );

    expect(html).toContain("text-align:center");
    expect(html).toContain("font-size:3em");
    expect(html).toContain("border-top:4px solid #3498db");
    expect(html).toContain("letter-spacing:3px");
    expect(html).toContain("NLP 入门");
  });

  it("removes the attribute entirely when nothing survives", () => {
    const html = render('<p style="position: absolute; z-index: 10">text</p>');

    expect(html).toBe("<p>text</p>");
  });

  it("leaves style-free markup untouched", () => {
    expect(render("<p>plain</p>")).toBe("<p>plain</p>");
  });

  it("renders a styled <font> tag, which is deprecated HTML but common in imported documents", () => {
    const html = render(
      '<font style="background-color:tomato; color:white; padding:4px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);font-weight: bold;">WordPiece详解</font>',
    );

    expect(html).toContain("background-color:tomato");
    expect(html).toContain("color:white");
    expect(html).toContain("padding:4px");
    expect(html).toContain("text-shadow:1px 1px 2px rgba(0,0,0,0.2)");
    expect(html).toContain("font-weight:bold");
    expect(html).toContain("WordPiece详解");
  });

  it("does not allow style on tags outside the styleable list", () => {
    // `mark` is rendered by the app itself with its own highlight styling; author styles
    // on it are not part of the allow-list.
    const html = render('<mark style="color: red">x</mark>');

    expect(html).not.toContain("style");
  });
});
