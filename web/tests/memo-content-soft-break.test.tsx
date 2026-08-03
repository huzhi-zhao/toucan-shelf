import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoMarkdownRenderer } from "@/components/MemoContent/MemoMarkdownRenderer";

// The renderer reads the author's global default straight out of the auth context; the
// per-document prop is the only thing under test here, so pin the default to hard breaks.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ userGeneralSetting: undefined }),
  useSoftBreakDefault: () => false,
}));

const NO_MENTIONS = new Set<string>();

const html = (content: string, softBreak?: boolean): string =>
  render(<MemoMarkdownRenderer content={content} resolvedMentionUsernames={NO_MENTIONS} softBreak={softBreak} />).container.innerHTML;

// A paragraph wrapped mid-sentence, the way markdown written outside this app routinely is.
const WRAPPED = "第一句话在这里，\n第二句其实是同一段的续行。";

describe("soft line breaks", () => {
  it("keeps the historical hard break when the document says nothing", () => {
    expect(html(WRAPPED)).toContain("<br>");
  });

  it("drops the break when the document opts into CommonMark wrapping", () => {
    const rendered = html(WRAPPED, true);
    expect(rendered).not.toContain("<br>");
    // The two lines land in one paragraph rather than being run together.
    expect(rendered).toContain("第一句话在这里，");
    expect(rendered).toContain("第二句其实是同一段的续行。");
  });

  it("still breaks paragraphs on a blank line either way", () => {
    for (const softBreak of [undefined, true]) {
      expect(html("上一段。\n\n下一段。", softBreak).match(/<p[\s>]/g)).toHaveLength(2);
    }
  });

  it("honours an explicit two-space hard break under soft wrapping", () => {
    expect(html("强制断行  \n下一行", true)).toContain("<br>");
  });
});
