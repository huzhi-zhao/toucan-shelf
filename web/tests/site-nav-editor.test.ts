import { describe, expect, it } from "vitest";
import { flattenNav, type NavRow, nestNav } from "@/components/Settings/siteNav";
import type { SiteNavItem } from "@/types/proto/api/v1/site_service_pb";

const node = (label: string, slug = "", children: SiteNavItem[] = []) => ({ label, slug, children }) as unknown as SiteNavItem;
const row = (depth: number, label: string, slug = ""): NavRow => ({ depth, label, slug });

describe("site nav editor rows", () => {
  it("flattens a tree into rows carrying their depth", () => {
    const tree = [node("Guides", "", [node("Start", "start"), node("Deep", "", [node("Deeper", "deeper")])]), node("About", "about")];
    expect(flattenNav(tree)).toEqual([
      row(0, "Guides"),
      row(1, "Start", "start"),
      row(1, "Deep"),
      row(2, "Deeper", "deeper"),
      row(0, "About", "about"),
    ]);
  });

  it("round trips", () => {
    const rows = [row(0, "Guides"), row(1, "Start", "start"), row(0, "About", "about")];
    expect(flattenNav(nestNav(rows))).toEqual(rows);
  });

  // The list cannot express "two levels deeper than the row above" — there is no
  // node in between to hang it on. Saving it as the nearest tree it can express
  // keeps the author's configuration from being rejected over an indent.
  it("clamps an indent that skips a level", () => {
    const nested = nestNav([row(0, "Guides"), row(3, "Start", "start")]);
    expect(nested).toHaveLength(1);
    expect(nested[0].children).toHaveLength(1);
    expect(nested[0].children[0].slug).toBe("start");
  });

  it("trims what the author typed", () => {
    expect(nestNav([row(0, "  Guides  ", "  start  ")])[0]).toMatchObject({ label: "Guides", slug: "start" });
  });
});
