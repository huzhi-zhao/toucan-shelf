import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { contentPreviewLines, propertyMap, textCardProperties } from "@/components/GalleryView/fields";
import { DEFAULT_GALLERY_BLOCK, type GalleryBlock } from "@/components/GalleryView/types";
import { type Memo, Memo_DocType, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const buildMemo = (content: string, overrides: Partial<Memo> = {}) =>
  create(MemoSchema, { name: "memos/1", content, docType: Memo_DocType.MARKDOWN, ...overrides });

const block = (overrides: Partial<GalleryBlock> = {}): GalleryBlock => ({ ...DEFAULT_GALLERY_BLOCK, ...overrides });

describe("textCardProperties", () => {
  it("lists the leading properties in document order, capped at three", () => {
    const props = propertyMap("---\na: 1\nb: two\nc: [x, y]\nd: 4\n---\nbody");
    expect(textCardProperties(props, block())).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "two" },
      { key: "c", value: "x, y" },
    ]);
  });

  it("skips empty values, config keys, and fields the card already shows", () => {
    // `cover` is the only key still treated as configuration — it's already drawn as the card's
    // cover image. Nothing else in frontmatter is special any more, view settings included.
    const props = propertyMap("---\ncover: pic.png\nempty:\nstatus: done\nowner: mo\n---\nbody");
    const rows = textCardProperties(props, block({ cardFields: { primary: "prop:status", secondary: "__updated__" } }));
    expect(rows).toEqual([{ key: "owner", value: "mo" }]);
  });

  it("skips the property used as the cover source", () => {
    const props = propertyMap("---\nbanner: pic.png\nowner: mo\n---\nbody");
    expect(textCardProperties(props, block({ cover: "prop:banner" }))).toEqual([{ key: "owner", value: "mo" }]);
  });
});

describe("contentPreviewLines", () => {
  it("takes the first prose lines, stripping frontmatter and markdown syntax", () => {
    const memo = buildMemo(["---", "a: 1", "---", "# Title", "", "Some **bold** text", "- [item](http://x)", "fourth"].join("\n"));
    expect(contentPreviewLines(memo)).toEqual(["Title", "Some bold text", "item"]);
  });

  it("ignores fenced code, rules, tables and bare images", () => {
    const memo = buildMemo(["---", "```", "code line", "```", "![](pic.png)", "| a | b |", "real text"].join("\n"));
    expect(contentPreviewLines(memo)).toEqual(["real text"]);
  });

  it("returns nothing for non-markdown documents", () => {
    expect(contentPreviewLines(buildMemo("hello", { docType: Memo_DocType.HTML }))).toEqual([]);
  });
});
