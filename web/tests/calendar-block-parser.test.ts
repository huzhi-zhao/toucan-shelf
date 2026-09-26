import { describe, expect, it, vi } from "vitest";
import { defaultVisibleMonth } from "@/components/MemoContent/calendar/defaultVisibleMonth";
import { parseCalendarBlock } from "@/components/MemoContent/calendar/parseCalendarBlock";

describe("parseCalendarBlock", () => {
  it("parses date groups with mixed checkbox and plain-text items", () => {
    const raw = [
      "- 2026-07-13",
      "",
      "- [ ] 制定规范的Vision，使命，年度规划",
      "- [x] 完成英文句型拼定",
      "- 推进NYC项目",
      "",
      "- 2026-07-08",
      "",
      "- [ ] memos vps+host 密钥mac客户端加密",
    ].join("\n");

    const { events, groups } = parseCalendarBlock(raw);

    expect(events).toEqual([]);
    expect(groups).toEqual([
      {
        date: "2026-07-13",
        items: [
          { text: "制定规范的Vision，使命，年度规划", checked: false, marker: " " },
          { text: "完成英文句型拼定", checked: true, marker: "x" },
          { text: "推进NYC项目", checked: undefined, marker: undefined },
        ],
      },
      {
        date: "2026-07-08",
        items: [{ text: "memos vps+host 密钥mac客户端加密", checked: false, marker: " " }],
      },
    ]);
  });

  it("puts items before any date line into an ungrouped section placed first", () => {
    const raw = ["- [ ] before any date", "- 2026-07-01", "- [ ] after date"].join("\n");

    const { groups } = parseCalendarBlock(raw);

    expect(groups[0]).toEqual({ date: undefined, items: [{ text: "before any date", checked: false, marker: " " }] });
    expect(groups[1]).toEqual({ date: "2026-07-01", items: [{ text: "after date", checked: false, marker: " " }] });
  });

  it("treats malformed date lines as ordinary items instead of starting a group", () => {
    const raw = ["- 2026/07/13", "- 13号", "- [ ] real item"].join("\n");

    const { groups } = parseCalendarBlock(raw);

    expect(groups).toEqual([
      {
        date: undefined,
        items: [
          { text: "2026/07/13", checked: undefined, marker: undefined },
          { text: "13号", checked: undefined, marker: undefined },
          { text: "real item", checked: false, marker: " " },
        ],
      },
    ]);
  });

  it("returns an empty array for empty or blank-only content", () => {
    expect(parseCalendarBlock("").groups).toEqual([]);
    expect(parseCalendarBlock("\n\n  \n").groups).toEqual([]);
  });

  it("ignores blank lines without breaking group membership", () => {
    const raw = ["- 2026-07-13", "", "", "- [ ] item one", "", "- [ ] item two"].join("\n");

    const { groups } = parseCalendarBlock(raw);

    expect(groups).toEqual([
      {
        date: "2026-07-13",
        items: [
          { text: "item one", checked: false, marker: " " },
          { text: "item two", checked: false, marker: " " },
        ],
      },
    ]);
  });
});

describe("defaultVisibleMonth", () => {
  it("always returns the current month regardless of the calendar data", () => {
    vi.setSystemTime(new Date(2026, 6, 12));
    expect(defaultVisibleMonth()).toEqual({ year: 2026, month: 6 });
  });

  it("tracks year rollover", () => {
    vi.setSystemTime(new Date(2027, 0, 2));
    expect(defaultVisibleMonth()).toEqual({ year: 2027, month: 0 });
  });
});
