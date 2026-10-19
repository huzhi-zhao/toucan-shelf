import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { calendarDocLabel, calendarDocsByDate } from "@/components/GalleryView/calendar";
import { type CalendarLayoutBlock, DEFAULT_CALENDAR_LAYOUT_BLOCK } from "@/components/GalleryView/types";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";

// Which day a document lands on is shared by the web calendar layout and the
// mobile reader's preview (mobile-phase3.md §4), so both show the same days.

const created = dayjs("2026-10-05T12:00:00").unix();

const doc = (title: string, content = "", folderPath = "notes") =>
  ({
    name: `memos/${title}`,
    title,
    content,
    folderPath,
    docType: Memo_DocType.MARKDOWN,
    attachments: [],
    createTime: { seconds: BigInt(created) },
    updateTime: { seconds: BigInt(created) },
  }) as unknown as Memo;

const view = doc("view", "", "notes");
const block = (patch: Partial<CalendarLayoutBlock> = {}): CalendarLayoutBlock => ({ ...DEFAULT_CALENDAR_LAYOUT_BLOCK, ...patch });
const titlesByDate = (map: Map<string, Memo[]>) => Object.fromEntries([...map].map(([date, docs]) => [date, docs.map((d) => d.title)]));

describe("calendarDocsByDate", () => {
  it("uses the date property, else the creation date, and leaves out the view itself", () => {
    const docs = [doc("a", "---\ndate: 2026-10-12\n---\n"), doc("b"), view];
    expect(titlesByDate(calendarDocsByDate(docs, block(), view))).toEqual({ "2026-10-12": ["a"], "2026-10-05": ["b"] });
  });

  it("with a configured date property, only documents carrying it appear", () => {
    const docs = [doc("a", "---\ndue: 2026-10-20\ndate: 2026-10-12\n---\n"), doc("b", "---\ndate: 2026-10-12\n---\n")];
    expect(titlesByDate(calendarDocsByDate(docs, block({ dateProperty: "due" }), view))).toEqual({ "2026-10-20": ["a"] });
  });

  it("keeps to the block's scope (the view's folder by default)", () => {
    const docs = [doc("in", "", "notes/sub"), doc("out", "", "other")];
    expect(titlesByDate(calendarDocsByDate(docs, block(), view))).toEqual({ "2026-10-05": ["in"] });
  });
});

describe("calendarDocLabel", () => {
  it("shows the card field, falling back to the title", () => {
    const d = doc("a", "---\nwho: Alice\n---\n");
    expect(calendarDocLabel(d, block({ cardField: "prop:who" }))).toBe("Alice");
    expect(calendarDocLabel(d, block({ cardField: "prop:missing" }))).toBe("a");
  });
});
