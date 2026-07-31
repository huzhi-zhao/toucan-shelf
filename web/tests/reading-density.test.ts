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
    expect(getLineSpacing()).toBeNull();
    expect(getParagraphSpacing()).toBeNull();
    // Nothing is written onto the DOM until the reader actually drags something.
    expect(getReadingSpacingStyle()).toBeUndefined();
  });

  it("emits only the custom properties the reader set", async () => {
    const { setLineSpacing, getReadingSpacingStyle, setParagraphSpacing } = await loadModule();

    setLineSpacing(2.1);
    expect(getReadingSpacingStyle()).toEqual({ "--md-leading": "2.1" });

    setParagraphSpacing(0.75);
    expect(getReadingSpacingStyle()).toEqual({ "--md-leading": "2.1", "--md-block-gap": "0.75rem" });
  });

  it("clears an override back to the preset when reset with null", async () => {
    const { setLineSpacing, setParagraphSpacing, getLineSpacing, getReadingSpacingStyle } = await loadModule();

    setLineSpacing(2.1);
    setParagraphSpacing(0.75);
    setLineSpacing(null);

    expect(getLineSpacing()).toBeNull();
    expect(getReadingSpacingStyle()).toEqual({ "--md-block-gap": "0.75rem" });
    // A cleared override leaves nothing behind to be picked up on the next load.
    expect(localStorage.getItem("memos-reading-line-spacing")).toBeNull();
  });

  it("keeps the style object identity stable between changes", async () => {
    // useSyncExternalStore compares snapshots by identity — a fresh object per read would
    // re-render forever.
    const { getReadingSpacingStyle, setLineSpacing } = await loadModule();

    setLineSpacing(1.9);
    const first = getReadingSpacingStyle();
    expect(getReadingSpacingStyle()).toBe(first);

    setLineSpacing(2);
    expect(getReadingSpacingStyle()).not.toBe(first);
  });

  it("clamps values dragged outside the slider range", async () => {
    const { setLineSpacing, setParagraphSpacing, getLineSpacing, getParagraphSpacing, LINE_SPACING_RANGE, PARAGRAPH_SPACING_RANGE } =
      await loadModule();

    setLineSpacing(99);
    setParagraphSpacing(-5);

    expect(getLineSpacing()).toBe(LINE_SPACING_RANGE.max);
    expect(getParagraphSpacing()).toBe(PARAGRAPH_SPACING_RANGE.min);
  });

  it("persists each preference independently and notifies subscribers", async () => {
    const { setCompactReading, setLineSpacing, subscribeReadingPreferences } = await loadModule();
    let notifications = 0;
    const unsubscribe = subscribeReadingPreferences(() => {
      notifications += 1;
    });

    setCompactReading(true);
    setLineSpacing(1.9);
    unsubscribe();
    setLineSpacing(1.6);

    expect(notifications).toBe(2);
    expect(localStorage.getItem("memos-compact-reading")).toBe("1");
    expect(localStorage.getItem("memos-reading-line-spacing")).toBe("1.6");
  });

  it("falls back to the preset for an unparsable stored value", async () => {
    localStorage.setItem("memos-reading-line-spacing", "enormous");
    const { getLineSpacing, getReadingSpacingStyle } = await loadModule();

    expect(getLineSpacing()).toBeNull();
    expect(getReadingSpacingStyle()).toBeUndefined();
  });
});
