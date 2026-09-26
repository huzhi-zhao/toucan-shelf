import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFillViewportHeight } from "@/components/MemoEditor/hooks/useFillViewportHeight";

// The editor on the memo detail page sizes itself to the room left below it.
// It has to be measured rather than inherited: the app's pages scroll in the
// document and every ancestor is min-h-*, so there is nothing for a
// `height: 100%` editor to resolve against.

const BOTTOM_GAP = 24;
const MIN_HEIGHT = 240;

/** A stand-in for the editor shell: reports what the hook decided. */
function Host({ enabled, top }: { enabled: boolean; top: number }) {
  const { ref, height, filling } = useFillViewportHeight(enabled);
  return (
    <div
      ref={(node) => {
        if (node) {
          node.getBoundingClientRect = () =>
            ({ top, x: 0, y: top, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
        }
        (ref as { current: HTMLDivElement | null }).current = node;
      }}
      data-testid="host"
      data-height={height ?? "none"}
      data-filling={String(filling)}
    />
  );
}

const heightOf = () => screen.getByTestId("host").getAttribute("data-height");

describe("useFillViewportHeight", () => {
  it("measures the room left below the editor", () => {
    window.innerHeight = 1000;
    render(<Host enabled top={200} />);
    expect(heightOf()).toBe(String(1000 - 200 - BOTTOM_GAP));
    expect(screen.getByTestId("host")).toHaveAttribute("data-filling", "true");
  });

  it("never asks for more than a screenful when the page is scrolled past the editor", () => {
    // A negative top would otherwise read as "more room than the screen has".
    window.innerHeight = 1000;
    render(<Host enabled top={-300} />);
    expect(heightOf()).toBe(String(1000 - BOTTOM_GAP));
  });

  it("keeps a usable minimum when there is almost no room left", () => {
    window.innerHeight = 1000;
    render(<Host enabled top={980} />);
    expect(heightOf()).toBe(String(MIN_HEIGHT));
  });

  it("measures nothing while disabled, so the editor keeps its normal cap", () => {
    window.innerHeight = 1000;
    render(<Host enabled={false} top={200} />);
    expect(heightOf()).toBe("none");
    expect(screen.getByTestId("host")).toHaveAttribute("data-filling", "false");
  });

  it("re-measures when the window resizes", () => {
    window.innerHeight = 1000;
    render(<Host enabled top={200} />);
    expect(heightOf()).toBe("776");
    act(() => {
      window.innerHeight = 600;
      window.dispatchEvent(new Event("resize"));
    });
    expect(heightOf()).toBe(String(600 - 200 - BOTTOM_GAP));
  });
});
