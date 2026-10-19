import { describe, expect, it } from "vitest";
import { coverUrl, sortDocs } from "@/components/GalleryView/cards";
import { propertyMap } from "@/components/GalleryView/fields";
import { DEFAULT_GALLERY_BLOCK, type GalleryBlock } from "@/components/GalleryView/types";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";

// Card order and covers are shared by the web renderer and the mobile reader's
// preview (mobile-phase3.md §4), so both always show the same cards.

const doc = (title: string, content = "", updated = 0) =>
  ({
    name: `memos/${title}`,
    title,
    content,
    docType: Memo_DocType.MARKDOWN,
    attachments: [],
    updateTime: { seconds: BigInt(updated) },
    createTime: { seconds: 0n },
  }) as unknown as Memo;

const block = (patch: Partial<GalleryBlock>): GalleryBlock => ({ ...DEFAULT_GALLERY_BLOCK, ...patch });

describe("sortDocs", () => {
  it("sorts by update time, newest first, by default", () => {
    const docs = [doc("a", "", 1), doc("b", "", 3), doc("c", "", 2)];
    expect(sortDocs(docs, block({ sort: "updated_desc" })).map((d) => d.title)).toEqual(["b", "c", "a"]);
  });

  it("sorts by a property numerically and puts documents without it last", () => {
    const docs = [doc("a", "---\nrank: 10\n---\n"), doc("b"), doc("c", "---\nrank: 2\n---\n")];
    expect(sortDocs(docs, block({ sort: "prop_asc:rank" })).map((d) => d.title)).toEqual(["c", "a", "b"]);
    expect(sortDocs(docs, block({ sort: "prop_desc:rank" })).map((d) => d.title)).toEqual(["a", "c", "b"]);
  });
});

describe("coverUrl", () => {
  it("has no cover when covers are off", () => {
    const d = doc("a", "![x](https://img.test/a.png)");
    expect(coverUrl(d, propertyMap(d.content), block({ cover: "none" }))).toBeUndefined();
  });

  it("falls back to the first inline image", () => {
    const d = doc("a", "text\n\n![x](https://img.test/a.png)");
    expect(coverUrl(d, propertyMap(d.content), block({ cover: "first_image" }))).toBe("https://img.test/a.png");
  });

  it("prefers the configured property", () => {
    const d = doc("a", "---\nposter: https://img.test/p.png\n---\n![x](https://img.test/a.png)");
    expect(coverUrl(d, propertyMap(d.content), block({ cover: "prop:poster" }))).toBe("https://img.test/p.png");
  });
});
