import { describe, expect, it } from "vitest";
import { parseGridBlock } from "@/components/MemoContent/grid/parseGridBlock";

describe("parseGridBlock", () => {
  it("keeps non-English field names as display fields, in source order", () => {
    const raw = ["- title: MacBook", "  价格: ¥8,000", "  brand: Apple", "  発売日: 2024", "  상태: 신품", "  备注2: 有货"].join("\n");

    const { cards } = parseGridBlock(raw);

    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("MacBook");
    expect(cards[0].fields).toEqual([
      { key: "价格", value: "¥8,000" },
      { key: "brand", value: "Apple" },
      { key: "発売日", value: "2024" },
      { key: "상태", value: "신품" },
      { key: "备注2", value: "有货" },
    ]);
  });

  it("still routes known keys case-insensitively and keeps colons inside values", () => {
    const raw = [
      "- Title: 示例",
      "  SUBTITLE: 副标题",
      "  Cover: https://example.com/a.png",
      "  url: https://example.com/page?a=1",
      "  NoCover: true",
      "  链接: https://example.com/x",
    ].join("\n");

    const [card] = parseGridBlock(raw).cards;

    expect(card).toEqual({
      title: "示例",
      subtitle: "副标题",
      cover: "https://example.com/a.png",
      url: "https://example.com/page?a=1",
      nocover: true,
      fields: [{ key: "链接", value: "https://example.com/x" }],
    });
  });

  it("does not treat value-like lines starting with a digit as fields", () => {
    const raw = ["- title: 会议", "  10:30 开始", "  时间: 10:30"].join("\n");

    const [card] = parseGridBlock(raw).cards;

    expect(card.fields).toEqual([{ key: "时间", value: "10:30" }]);
  });

  it("starts a new card on a non-English entry key, which is dropped without a title", () => {
    const raw = ["- title: A", "- 标题: 没有 title 的卡", "  价格: 1", "- title: B", "  价格: 2"].join("\n");

    const { cards } = parseGridBlock(raw);

    expect(cards.map((c) => c.title)).toEqual(["A", "B"]);
    expect(cards[0].fields).toEqual([]);
    expect(cards[1].fields).toEqual([{ key: "价格", value: "2" }]);
  });

  it("only recognises English block config keys and ignores unknown non-English ones", () => {
    const raw = ["样式: longbar", "TYPE: longbar", "NoCover: true", "columns: 3", "- title: A"].join("\n");

    expect(parseGridBlock(raw)).toMatchObject({ style: "longbar", nocover: true, columns: 3 });
    expect(parseGridBlock(["样式: longbar", "- title: A"].join("\n")).style).toBe("card");
  });
});
