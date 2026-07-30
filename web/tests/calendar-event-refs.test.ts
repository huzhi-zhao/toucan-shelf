import { describe, expect, it } from "vitest";
import { parseCalendarBlock } from "@/components/MemoContent/calendar/parseCalendarBlock";
import { toggleCalendarEvent } from "@/components/MemoContent/calendar/upsertCalendarItem";

const wrap = (block: string) => ["# memo", "```calendar", block, "```", ""].join("\n");

describe("calendar event refs", () => {
  it("resolves numeric refs to event names by position", () => {
    const parsed = parseCalendarBlock(["events: 早睡, 喝水", "- 2026-07-19", "- @1", "- @2"].join("\n"));
    expect(parsed.events).toEqual(["早睡", "喝水"]);
    expect(parsed.groups[0].items.map((i) => i.text)).toEqual(["早睡", "喝水"]);
  });

  it("survives renaming an event", () => {
    const parsed = parseCalendarBlock(["events: 早点睡, 喝水", "- 2026-07-19", "- @1"].join("\n"));
    expect(parsed.groups[0].items[0].text).toBe("早点睡");
  });

  it("still accepts legacy name refs", () => {
    const parsed = parseCalendarBlock(["events: 早睡", "- 2026-07-19", "- @早睡"].join("\n"));
    expect(parsed.groups[0].items[0].text).toBe("早睡");
  });

  it("writes numeric refs when toggling on", () => {
    const content = wrap(["events: 早睡, 喝水", "- 2026-07-19"].join("\n"));
    expect(toggleCalendarEvent(content, "2026-07-19", "喝水", true, ["早睡", "喝水"])).toContain("- @2");
  });

  it("removes a legacy name-form line when toggling off", () => {
    const content = wrap(["events: 早睡", "- 2026-07-19", "- @早睡"].join("\n"));
    expect(toggleCalendarEvent(content, "2026-07-19", "早睡", false, ["早睡"])).not.toContain("@早睡");
  });

  it("parses allowMaxUpdateDays", () => {
    expect(parseCalendarBlock("allowMaxUpdateDays: 7\n- 2026-07-19").allowMaxUpdateDays).toBe(7);
    expect(parseCalendarBlock("- 2026-07-19").allowMaxUpdateDays).toBeUndefined();
  });

  it("parses weekStartDay", () => {
    expect(parseCalendarBlock("weekStartDay: 1\n- 2026-07-19").weekStartDay).toBe(1);
    expect(parseCalendarBlock("@weekStartDay: 7\n- 2026-07-19").weekStartDay).toBe(7);
    expect(parseCalendarBlock("weekStartDay: 8\n- 2026-07-19").weekStartDay).toBeUndefined();
    expect(parseCalendarBlock("- 2026-07-19").weekStartDay).toBeUndefined();
  });

  it("parses showTaskDot", () => {
    expect(parseCalendarBlock("showTaskDot: true\n- 2026-07-19").showTaskDot).toBe(true);
    expect(parseCalendarBlock("@showTaskDot: false\n- 2026-07-19").showTaskDot).toBe(false);
    expect(parseCalendarBlock("- 2026-07-19").showTaskDot).toBeUndefined();
  });
});
