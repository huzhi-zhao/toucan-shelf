import { describe, expect, it } from "vitest";
import { newCalendarDoc } from "@/components/GalleryView/calendar";
import { matchesScope, propertyMap } from "@/components/GalleryView/fields";
import type { CalendarLayoutBlock, GalleryScope } from "@/components/GalleryView/types";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

// A gallery tag rule used to read Memo.tags, which the server filled from the body
// `#tag` syntax. That syntax is gone, so the rule reads the frontmatter `tags:`
// property — the one place document classification lives now.
const tagScope = (tag: string): GalleryScope => ({
  match: "all",
  groups: [{ match: "all", rules: [{ kind: "tag", tag }] }],
});

const doc = (content: string) => ({ content, folderPath: "", tags: [] }) as unknown as Memo;

const matches = (content: string, tag: string) => matchesScope(doc(content), propertyMap(content), tagScope(tag), { viewFolderPath: "" });

describe("gallery tag scope", () => {
  it("matches a document whose frontmatter tag list contains the tag", () => {
    expect(matches("---\ntags: [work, urgent]\n---\n# Doc", "work")).toBe(true);
  });

  it("matches a scalar tags property", () => {
    expect(matches("---\ntags: work\n---\n# Doc", "work")).toBe(true);
  });

  it("does not match a different tag, or a bare #hash in the body", () => {
    expect(matches("---\ntags: [home]\n---\n# Doc", "work")).toBe(false);
    expect(matches("# Doc\n\n#work", "work")).toBe(false);
  });
});

describe("newCalendarDoc", () => {
  const block = (scope: GalleryScope) => ({ dateProperty: "due", newDocFolder: "", scope }) as unknown as CalendarLayoutBlock;

  it("seeds a tag rule as a frontmatter tags property, not a body hashtag", () => {
    const { content } = newCalendarDoc(block(tagScope("work")), "notes", "2026-09-11", "Plan");
    expect(content).toContain("tags: [work]");
    expect(content).not.toContain("#work");
    // The seeded document must fall inside the block's own scope.
    expect(matches(content, "work")).toBe(true);
  });
});
