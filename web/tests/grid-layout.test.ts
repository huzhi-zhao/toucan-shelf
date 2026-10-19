import { describe, expect, it } from "vitest";
import { gridCardKind, gridHidesCovers, textCardSlots } from "@/components/MemoContent/grid/layout";
import { type GridCardData, parseGridBlock } from "@/components/MemoContent/grid/parseGridBlock";

// Card layouts and text-card slots are shared by the web grid and the mobile
// reader's read-only preview (mobile-phase3.md §4).

const card = (patch: Partial<GridCardData> = {}): GridCardData => ({ title: "t", fields: [], ...patch });

describe("gridHidesCovers", () => {
  it("hides covers when asked to", () => {
    expect(gridHidesCovers({ nocover: true, cards: [card({ cover: "a.png" })] })).toBe(true);
  });

  it("hides covers when no card has one", () => {
    expect(gridHidesCovers({ nocover: false, cards: [card(), card()] })).toBe(true);
  });

  it("keeps covers when any card has one", () => {
    expect(gridHidesCovers({ nocover: false, cards: [card(), card({ cover: "a.png" })] })).toBe(false);
  });
});

describe("gridCardKind", () => {
  it("is a strip in a longbar grid, whatever the card says", () => {
    expect(gridCardKind(card({ cover: "a.png" }), true, false)).toBe("longbar");
  });

  it("is a text card when the grid hides covers or the card opts out", () => {
    expect(gridCardKind(card({ cover: "a.png" }), false, true)).toBe("text");
    expect(gridCardKind(card({ cover: "a.png", nocover: true }), false, false)).toBe("text");
  });

  it("is a cover card otherwise, even without a cover of its own", () => {
    expect(gridCardKind(card(), false, false)).toBe("cover");
  });
});

describe("textCardSlots", () => {
  it("pins the last field as a footer and pairs the rest two to a row", () => {
    const { cards } = parseGridBlock(`- title: Flat
  price: 4200
  area: 60m2
  rooms: 2
  date: 2026-10-19`);
    const { rows, footer } = textCardSlots(cards[0]);
    expect(rows.map((r) => [r.left?.value, r.right?.value])).toEqual([
      ["4200", "60m2"],
      ["2", undefined],
    ]);
    expect(footer?.value).toBe("2026-10-19");
  });

  it("keeps a lone field in the body", () => {
    const { rows, footer } = textCardSlots(card({ fields: [{ key: "price", value: "1" }] }));
    expect(rows).toHaveLength(1);
    expect(footer).toBeUndefined();
  });

  it("caps the body so the card stays within six rows", () => {
    const fields = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, value: String(i) }));
    // title + subtitle + footer leave three rows of two.
    const { rows } = textCardSlots(card({ subtitle: "s", fields }));
    expect(rows).toHaveLength(3);
  });
});
