import { describe, expect, it } from "vitest";
import { headingIdCandidates, headingSlug, resolveHeadingTarget } from "@/utils/heading-anchor";

describe("headingSlug", () => {
  it("keeps CJK and produces a readable slug, dropping emoji/punctuation", () => {
    // Matches the rendered heading id for `# 82年，🔥了，【Fire，fire】`.
    expect(headingSlug("82年，🔥了，【Fire，fire】")).toBe("82年了firefire");
  });

  it("is idempotent — slugging an already-slugged value is a no-op", () => {
    const once = headingSlug("Hello, World!");
    expect(headingSlug(once)).toBe(once);
  });

  it("falls back to a stable h-<hash> when the slug would be empty", () => {
    const a = headingSlug("🔥🔥");
    const b = headingSlug("【】");
    expect(a).toMatch(/^h-[0-9a-z]+$/);
    expect(b).toMatch(/^h-[0-9a-z]+$/);
    expect(a).not.toBe(b); // different text → different id
    expect(headingSlug("🔥🔥")).toBe(a); // stable across calls
  });
});

describe("headingIdCandidates", () => {
  it("resolves a raw-text anchor to the canonical slug", () => {
    expect(headingIdCandidates("82年，🔥了，【Fire，fire】")).toContain("82年了firefire");
  });

  it("strips a leading h- prefix and slugifies", () => {
    expect(headingIdCandidates("h-82年，🔥了，【Fire，fire】")).toContain("82年了firefire");
  });

  it("handles percent-encoded fragments", () => {
    expect(headingIdCandidates(encodeURIComponent("82年，🔥了，【Fire，fire】"))).toContain("82年了firefire");
  });

  it("keeps the exact fragment first for existing precise anchors (footnotes)", () => {
    expect(headingIdCandidates("fn-1")[0]).toBe("fn-1");
  });
});

describe("resolveHeadingTarget", () => {
  const makeRoot = (id: string): HTMLElement => {
    const root = document.createElement("div");
    const h = document.createElement("h2");
    h.id = id;
    root.appendChild(h);
    return root;
  };

  it("finds a heading when the link uses the raw title", () => {
    const root = makeRoot("82年了firefire");
    expect(resolveHeadingTarget(root, "h-82年，🔥了，【Fire，fire】")).not.toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(resolveHeadingTarget(makeRoot("notes"), "nonexistent")).toBeNull();
  });

  it("returns null for empty fragment or missing root", () => {
    expect(resolveHeadingTarget(makeRoot("notes"), "")).toBeNull();
    expect(resolveHeadingTarget(null, "notes")).toBeNull();
  });
});
