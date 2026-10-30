import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  DocConfig_BulletListStyle,
  DocConfig_ReferenceSort,
  DocConfigSchema,
  Memo_DocType,
  MemoSchema,
} from "@/types/proto/api/v1/memo_service_pb";
import { bulletListStyleToProto, resolveDocConfig, sortSubDocs } from "@/utils/docConfig";

describe("bullet list style", () => {
  it("resolves the stored style, and anything unknown to the plain list", () => {
    expect(resolveDocConfig(undefined).bulletListStyle).toBe("plain");
    expect(resolveDocConfig(create(DocConfigSchema, { bulletListStyle: DocConfig_BulletListStyle.CARDS })).bulletListStyle).toBe("cards");
    expect(resolveDocConfig(create(DocConfigSchema, { bulletListStyle: DocConfig_BulletListStyle.PLAIN })).bulletListStyle).toBe("plain");
    expect(resolveDocConfig(create(DocConfigSchema, { bulletListStyle: 9 as DocConfig_BulletListStyle })).bulletListStyle).toBe("plain");
  });

  it("saves back as the stored enum", () => {
    expect(bulletListStyleToProto("cards")).toBe(DocConfig_BulletListStyle.CARDS);
    expect(bulletListStyleToProto("plain")).toBe(DocConfig_BulletListStyle.PLAIN);
  });
});

describe("sortSubDocs", () => {
  const doc = (title: string, created: number, updated: number, docType = Memo_DocType.MARKDOWN) =>
    create(MemoSchema, {
      title,
      docType,
      createTime: create(TimestampSchema, { seconds: BigInt(created) }),
      updateTime: create(TimestampSchema, { seconds: BigInt(updated) }),
    });
  const docs = [doc("b", 2, 30), doc("a10", 3, 10, Memo_DocType.PDF), doc("a2", 1, 20, Memo_DocType.HTML)];
  const titles = (sort: DocConfig_ReferenceSort, descending = false) => sortSubDocs(docs, sort, descending).map((d) => d.title);

  it("orders by each key, either way, and keeps the server order when unset", () => {
    expect(titles(DocConfig_ReferenceSort.REFERENCE_SORT_UNSPECIFIED)).toEqual(["b", "a10", "a2"]);
    expect(titles(DocConfig_ReferenceSort.CREATED)).toEqual(["a2", "b", "a10"]);
    expect(titles(DocConfig_ReferenceSort.UPDATED, true)).toEqual(["b", "a2", "a10"]);
    expect(titles(DocConfig_ReferenceSort.TITLE)).toEqual(["a2", "a10", "b"]);
    expect(titles(DocConfig_ReferenceSort.TYPE)).toEqual(["b", "a2", "a10"]);
    expect(titles(9 as DocConfig_ReferenceSort)).toEqual(["b", "a10", "a2"]);
  });
});
