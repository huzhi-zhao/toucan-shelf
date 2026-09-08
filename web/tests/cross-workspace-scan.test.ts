import { describe, expect, it } from "vitest";
import { extractWorkspaceQualifiedTitles } from "@/components/MemoContent/crossWorkspace";

/**
 * R2.3: the prefetch scan decides which knowledge bases get looked up before a
 * document renders. It must find every title the renderer will ask for, and
 * must not turn ordinary prose into workspace lookups.
 */
describe("extractWorkspaceQualifiedTitles", () => {
  it("finds the titles of workspace-qualified link destinations", () => {
    const titles = extractWorkspaceQualifiedTitles("see [a](@产品手册/fb/dc.md) and [b](@技术笔记/x.md)");
    expect(titles).toEqual(["产品手册", "技术笔记"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(extractWorkspaceQualifiedTitles("[a](@Career/x) [b](@career/y)")).toEqual(["Career"]);
  });

  it("percent-decodes a title", () => {
    expect(extractWorkspaceQualifiedTitles("[a](@Product%20Handbook/x)")).toEqual(["Product Handbook"]);
  });

  it("ignores an @mention in prose", () => {
    expect(extractWorkspaceQualifiedTitles("hi @someone/ping, and mail a@b.com")).toEqual([]);
  });

  it("ignores malformed qualified hrefs", () => {
    expect(extractWorkspaceQualifiedTitles("[a](@nopath) [b](@/x.md) [c](@lib/../x.md)")).toEqual([]);
  });

  it("ignores in-workspace and external destinations", () => {
    expect(extractWorkspaceQualifiedTitles("[a](/fa/db.md) [b](./db.md) [c](https://example.com)")).toEqual([]);
  });
});
