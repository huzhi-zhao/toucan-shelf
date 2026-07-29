import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { DocConfigSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { DEFAULT_DOC_CONFIG, resolveDocConfig, resolveMemoDocConfig } from "@/utils/docConfig";

describe("resolveDocConfig", () => {
  it("falls back to the app defaults when nothing is configured", () => {
    expect(resolveDocConfig(undefined)).toEqual(DEFAULT_DOC_CONFIG);
  });

  it("keeps an explicit false distinct from unset", () => {
    const resolved = resolveDocConfig(create(DocConfigSchema, { fullWidth: false }));
    expect(resolved.fullWidth).toBe(false);
    // The untouched knobs still resolve to their defaults rather than to false.
    expect(resolved.displayOutline).toBe(true);
    expect(resolved.displayFilter).toBe(true);
    expect(resolved.showProperties).toBe(true);
  });

  it("carries every configured field through", () => {
    const config = create(DocConfigSchema, { fullWidth: false, displayOutline: false, displayFilter: false, showProperties: false });
    expect(resolveDocConfig(config)).toEqual({
      fullWidth: false,
      displayOutline: false,
      displayFilter: false,
      showProperties: false,
    });
  });

  it("ignores frontmatter entirely — a document's text never decides its styling", () => {
    const memo = create(MemoSchema, {
      content: "---\ndisplayOutline: false\ndisplayFilter: false\nhidden: true\n---\n# Title\n",
    });
    expect(resolveMemoDocConfig(memo)).toEqual(DEFAULT_DOC_CONFIG);
  });

  it("defaults for a missing memo", () => {
    expect(resolveMemoDocConfig(undefined)).toEqual(DEFAULT_DOC_CONFIG);
  });
});
