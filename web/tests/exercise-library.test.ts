import { describe, expect, it } from "vitest";
import { groupGuides, guideMatches, guideOf } from "@/utils/exerciseLibrary";

const doc = (name: string, title: string, frontmatter: string) => ({ name, title, content: `---\n${frontmatter}\n---\n# ${title}\n` });

describe("exercise library", () => {
  it("reads a guide's group and aliases from its frontmatter", () => {
    const guide = guideOf(doc("memos/a", "臀推", 'kind: exercise\ngroup: 腿臀\naliases: ["Bench hip thrust", "Hip thrust"]'));
    expect(guide).toEqual({ name: "memos/a", title: "臀推", group: "腿臀", aliases: ["Bench hip thrust", "Hip thrust"] });
  });

  it("accepts a block list of aliases and a guide with no group", () => {
    const guide = guideOf(doc("memos/b", "平板支撑", "kind: exercise\naliases:\n  - Plank"));
    expect(guide).toMatchObject({ group: "", aliases: ["Plank"] });
  });

  it("is not a guide without kind: exercise", () => {
    expect(guideOf(doc("memos/c", "周计划", "kind: plan"))).toBeUndefined();
    expect(guideOf({ name: "memos/d", title: "随笔", content: "提到 kind: exercise 但没有 frontmatter" })).toBeUndefined();
  });

  it("searches titles and aliases, ignoring case", () => {
    const guide = { name: "memos/a", title: "单臂哑铃划船", group: "拉", aliases: ["One-arm dumbbell row", "Single-arm dumbbell row"] };
    expect(guideMatches(guide, "划船")).toBe(true);
    expect(guideMatches(guide, "SINGLE-ARM")).toBe(true);
    expect(guideMatches(guide, "深蹲")).toBe(false);
    expect(guideMatches(guide, "  ")).toBe(true);
  });

  it("orders the known groups first, other groups after, ungrouped last", () => {
    const g = (title: string, group: string) => ({ name: `memos/${title}`, title, group, aliases: [] });
    const groups = groupGuides([g("卷腹", "核心"), g("热身", ""), g("划船", "拉"), g("臀推", "腿臀"), g("拉伸", "放松"), g("深蹲", "腿臀")]);
    expect(groups.map((x) => x.group)).toEqual(["腿臀", "拉", "核心", "放松", ""]);
    expect(groups[0].guides.map((x) => x.title)).toHaveLength(2);
  });
});
