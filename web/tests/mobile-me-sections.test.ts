import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { flattenSections, isMeTile, meSections } from "@/hooks/useMeItems";
import { UserSetting_MeGroupSchema, UserSetting_MeItem_Style, UserSetting_MeItemSchema } from "@/types/proto/api/v1/user_service_pb";

const item = (id: string, group = "") => create(UserSetting_MeItemSchema, { id, title: id, group });
const group = (id: string) => create(UserSetting_MeGroupSchema, { id, title: id });

describe("meSections", () => {
  it("puts ungrouped items first, then each group in its order, keeping item order within a block", () => {
    const sections = meSections({
      items: [item("a", "g2"), item("b"), item("c", "g1"), item("d", "g2"), item("e")],
      groups: [group("g1"), group("g2")],
    });
    expect(sections.map((s) => [s.group?.id ?? "", s.items.map((i) => i.id)])).toEqual([
      ["", ["b", "e"]],
      ["g1", ["c"]],
      ["g2", ["a", "d"]],
    ]);
  });

  it("treats an item naming a deleted group as ungrouped and keeps empty groups", () => {
    const sections = meSections({ items: [item("a", "gone")], groups: [group("g1")] });
    expect(sections[0].items.map((i) => i.id)).toEqual(["a"]);
    expect(sections[1].items).toEqual([]);
  });

  it("flattens back to the display order", () => {
    const sections = meSections({ items: [item("a", "g1"), item("b")], groups: [group("g1")] });
    expect(flattenSections(sections).map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("isMeTile", () => {
  it("picks the items styled as grid tiles", () => {
    expect(isMeTile(create(UserSetting_MeItemSchema, { id: "a", style: UserSetting_MeItem_Style.GRID }))).toBe(true);
    expect(isMeTile(create(UserSetting_MeItemSchema, { id: "b", style: UserSetting_MeItem_Style.SINGLE_LINE }))).toBe(false);
  });
});
