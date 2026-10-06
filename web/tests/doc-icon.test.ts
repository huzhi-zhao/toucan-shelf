import { describe, expect, it } from "vitest";
import { DOC_ICON_PRESETS, normalizeDocIcon } from "@/utils/docIcon";

describe("normalizeDocIcon", () => {
  it("accepts a single emoji, including multi-codepoint ones", () => {
    for (const emoji of ["🏆", "❤️", "1️⃣", "🇨🇦", "👨‍👩‍👧‍👦", "👍🏽", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) {
      expect(normalizeDocIcon(emoji)).toBe(emoji);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDocIcon("  🏆 ")).toBe("🏆");
  });

  it("rejects text, several emoji and empty input", () => {
    for (const input of ["", "  ", "a", "1", "温", "🏆 温尼伯", "🏆🏆", "#"]) {
      expect(normalizeDocIcon(input)).toBeUndefined();
    }
  });

  it("offers only valid, distinct presets", () => {
    for (const emoji of DOC_ICON_PRESETS) {
      expect(normalizeDocIcon(emoji)).toBe(emoji);
    }
    expect(new Set(DOC_ICON_PRESETS).size).toBe(DOC_ICON_PRESETS.length);
  });
});
