import { parser as baseParser, GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { cjkEmphasis } from "@/components/MemoEditor/Editor/cjkEmphasis";

const withCjk = baseParser.configure([GFM, cjkEmphasis]);
const withoutCjk = baseParser.configure([GFM]);

/** The source text of every StrongEmphasis node, marks included. */
const strongRuns = (parser: typeof baseParser, text: string): string[] => {
  const runs: string[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name === "StrongEmphasis") runs.push(text.slice(node.from, node.to));
    },
  });
  return runs;
};

const strong = (text: string) => strongRuns(withCjk, text);

describe("editor CJK-friendly emphasis highlighting", () => {
  it("bolds a run ending with a full-width colon followed by CJK text", () => {
    expect(strong("**注意：**这里要小心")).toEqual(["**注意：**"]);
  });

  it("bolds a run in the middle of a sentence", () => {
    expect(strong("前**加粗。**后")).toEqual(["**加粗。**"]);
  });

  it("bolds several such runs on one line", () => {
    expect(strong("**注意：**这里要小心 和 前**加粗。**后")).toEqual(["**注意：**", "**加粗。**"]);
  });

  it("bolds a run wrapped in full-width parentheses", () => {
    expect(strong("**（注）**说明")).toEqual(["**（注）**"]);
  });

  it("bolds a full-width-punctuation run followed by latin text", () => {
    expect(strong("**加粗：**English")).toEqual(["**加粗：**"]);
    expect(strong("10**％**下降")).toEqual(["**％**"]);
  });

  it("bolds a latin run whose closing delimiter is followed by CJK text", () => {
    expect(strong("**加粗-**继续")).toEqual(["**加粗-**"]);
  });

  it("keeps latin-only text on CommonMark rules", () => {
    expect(strong("**bold-**next")).toEqual([]);
    expect(strong("**bold.**next")).toEqual([]);
  });

  it("still refuses a space before the closing delimiter", () => {
    expect(strong("**加粗 **尾部空格")).toEqual([]);
  });

  it("leaves cases CommonMark already handles to the built-in parser", () => {
    for (const text of ["**加粗**：说明", "**bold**text", "普通**加粗**文字", "***粗斜体***", "**外层 *内层* 外层**", "**a**b**c**"]) {
      expect(strong(text)).toEqual(strongRuns(withoutCjk, text));
    }
  });

  it("does not swallow nested inline constructs", () => {
    // A backtick or link inside the run means the built-in parser keeps it, so
    // the nested markup is still highlighted.
    expect(strong("**注意：`code`**这里")).toEqual(strongRuns(withoutCjk, "**注意：`code`**这里"));
    expect(strong("**[链接](u)：**这里")).toEqual(strongRuns(withoutCjk, "**[链接](u)：**这里"));
  });

  it("does not reach across lines or into the next paragraph", () => {
    expect(strong("**注意：\n**这里")).toEqual([]);
  });
});
