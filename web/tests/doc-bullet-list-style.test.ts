import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { DocConfig_BulletListStyle, DocConfigSchema } from "@/types/proto/api/v1/memo_service_pb";
import { bulletListStyleToProto, resolveDocConfig } from "@/utils/docConfig";

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
