import { describe, expect, it } from "vitest";
import { parseCalendarBlock } from "@/components/MemoContent/calendar/parseCalendarBlock";
import { setCalendarEventComment, setCalendarItemStatus, toggleCalendarEvent } from "@/components/MemoContent/calendar/upsertCalendarItem";

const EVENTS = ["跑恩", "冥想", "运动"];
const wrap = (lines: string[]) => ["# memo", "```calendar", `events: ${EVENTS.join(", ")}`, ...lines, "```", ""].join("\n");
const parseBody = (content: string) => parseCalendarBlock(content.split("```calendar\n")[1].split("\n```")[0]);

describe("calendar event comments", () => {
  it("parses a comment after a numeric ref", () => {
    const item = parseCalendarBlock(["events: 运动", "- 2026-10-09", "- @1 跑步10分钟"].join("\n")).groups[0].items[0];
    expect(item).toMatchObject({ text: "运动", isEvent: true, comment: "跑步10分钟" });
    expect(item.hidden).toBeUndefined();
  });

  it("parses a comment after a legacy name ref, preferring the longest declared name", () => {
    const parsed = parseCalendarBlock(["events: 跑, 跑步", "- 2026-10-09", "- @跑步 十分钟", "- @跑"].join("\n"));
    expect(parsed.groups[0].items.map(({ text, comment }) => ({ text, comment }))).toEqual([
      { text: "跑步", comment: "十分钟" },
      { text: "跑", comment: undefined },
    ]);
  });

  it("parses `~@` lines as hidden events that keep their comment", () => {
    const item = parseCalendarBlock(["events: 运动", "- 2026-10-09", "- ~@1 跑步10分钟"].join("\n")).groups[0].items[0];
    expect(item).toMatchObject({ text: "运动", isEvent: true, hidden: true, comment: "跑步10分钟" });
  });

  it("sets, replaces and clears a comment", () => {
    let content = wrap(["- 2026-10-09", "- @3"]);
    content = setCalendarEventComment(content, "2026-10-09", "运动", "跑步10分钟", EVENTS);
    expect(content).toContain("- @3 跑步10分钟");
    content = setCalendarEventComment(content, "2026-10-09", "运动", "跑步\n20分钟", EVENTS);
    expect(content).toContain("- @3 跑步 20分钟");
    content = setCalendarEventComment(content, "2026-10-09", "运动", "  ", EVENTS);
    expect(content).toMatch(/- @3\n|- @3$/m);
    expect(content).not.toContain("跑步");
  });

  it("marks the event as occurred when commenting on a day without it", () => {
    const content = setCalendarEventComment(wrap([]), "2026-10-09", "运动", "跑步", EVENTS);
    expect(content).toContain("- 2026-10-09\n- @3 跑步");
  });

  it("hides instead of deleting when unchecking a commented event, and restores it on re-check", () => {
    const original = wrap(["- 2026-10-09", "- @3 跑步10分钟", "- [ ] 买菜"]);
    const hidden = toggleCalendarEvent(original, "2026-10-09", "运动", false, EVENTS);
    expect(hidden).toContain("- ~@3 跑步10分钟");
    const parsed = parseBody(hidden);
    expect(parsed.groups[0].items.find((i) => i.isEvent)?.hidden).toBe(true);

    const restored = toggleCalendarEvent(hidden, "2026-10-09", "运动", true, EVENTS);
    expect(restored).toContain("- @3 跑步10分钟");
    expect(restored).not.toContain("~@");
  });

  it("still deletes an uncommented event when unchecking", () => {
    const content = toggleCalendarEvent(wrap(["- 2026-10-09", "- @3", "- @2"]), "2026-10-09", "运动", false, EVENTS);
    expect(content).not.toContain("@3");
    expect(content).toContain("- @2");
  });

  it("commenting on a hidden event restores it", () => {
    const content = setCalendarEventComment(wrap(["- 2026-10-09", "- ~@3 旧评论"]), "2026-10-09", "运动", "新评论", EVENTS);
    expect(content).toContain("- @3 新评论");
    expect(content).not.toContain("旧评论");
  });

  it("keeps task indexes aligned with hidden event lines in the group", () => {
    const content = wrap(["- 2026-10-09", "- ~@3 跑步", "- [ ] 买菜"]);
    const parsed = parseBody(content);
    const taskIndex = parsed.groups[0].items.findIndex((i) => !i.isEvent);
    expect(setCalendarItemStatus(content, "2026-10-09", taskIndex, "x")).toContain("- [x] 买菜");
  });
});
