import { beforeEach, describe, expect, it, vi } from "vitest";

// The module reads localStorage once at import time, so each case gets a fresh copy.
const loadModule = () => import("@/utils/readingDensity");

describe("reading density preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults to the reading density with no spacing overrides", async () => {
    const { getCompactReading, getLineSpacing, getParagraphSpacing, getReadingSpacingStyle } = await loadModule();

    expect(getCompactReading()).toBe(false);
    expect(getLineSpacing()).toBe("auto");
    expect(getParagraphSpacing()).toBe("auto");
    // Nothing is written onto the DOM until the reader actually picks a value.
    expect(getReadingSpacingStyle()).toBeUndefined();
  });

  it("emits only the custom properties the reader set", async () => {
    const { setLineSpacing, getReadingSpacingStyle, setParagraphSpacing } = await loadModule();

    setLineSpacing("loose");
    expect(getReadingSpacingStyle()).toEqual({ "--md-leading": "2.05" });

    setParagraphSpacing("tight");
    expect(getReadingSpacingStyle()).toEqual({ "--md-leading": "2.05", "--md-block-gap": "0.5rem" });

    setLineSpacing("auto");
    expect(getReadingSpacingStyle()).toEqual({ "--md-block-gap": "0.5rem" });
  });

  it("persists each preference independently and notifies subscribers", async () => {
    const { setCompactReading, setLineSpacing, subscribeReadingPreferences } = await loadModule();
    let notifications = 0;
    const unsubscribe = subscribeReadingPreferences(() => {
      notifications += 1;
    });

    setCompactReading(true);
    setLineSpacing("normal");
    unsubscribe();
    setLineSpacing("tight");

    expect(notifications).toBe(2);
    expect(localStorage.getItem("memos-compact-reading")).toBe("1");
    expect(localStorage.getItem("memos-reading-line-spacing")).toBe("tight");
  });

  it("falls back to auto for an unrecognised stored value", async () => {
    localStorage.setItem("memos-reading-line-spacing", "enormous");
    const { getLineSpacing } = await loadModule();

    expect(getLineSpacing()).toBe("auto");
  });
});
