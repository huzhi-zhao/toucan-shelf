import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

const render = (content: string): string =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{content}</ReactMarkdown>);

describe("CJK-friendly emphasis", () => {
  it("bolds a run ending with a full-width colon followed by CJK text", () => {
    expect(render("**注意：**这里要小心")).toContain("<strong>注意：</strong>这里要小心");
  });

  it("bolds a run ending with a full-width period followed by CJK text", () => {
    expect(render("前**加粗。**后")).toContain("<strong>加粗。</strong>");
  });

  it("bolds a run wrapped in full-width parentheses", () => {
    expect(render("**（注）**说明")).toContain("<strong>（注）</strong>说明");
  });

  it("handles several such runs in one paragraph", () => {
    const html = render("**要点一：**说明；**要点二：**说明");
    expect(html).toContain("<strong>要点一：</strong>");
    expect(html).toContain("<strong>要点二：</strong>");
  });

  it("still refuses emphasis with a space before the closing delimiter", () => {
    expect(render("**加粗 **尾部空格")).not.toContain("<strong>");
  });

  it("leaves intraword underscores alone", () => {
    expect(render("变量 some_var_name 保持原样")).not.toContain("<em>");
  });
});
