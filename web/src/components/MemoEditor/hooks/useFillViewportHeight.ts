import { useLayoutEffect, useRef, useState } from "react";

/** Breathing room left below the editor so it never sits flush against the viewport edge. */
const BOTTOM_GAP = 24;

/** Below this the "filled" editor would be smaller than the cap it replaces, so it is not worth filling. */
const MIN_HEIGHT = 240;

/**
 * Measures the height left below an element in the viewport, for an editor that
 * should occupy the rest of the screen on a page that has no definite height to
 * inherit.
 *
 * Sizing by CSS is not available here: the app's pages scroll in the document
 * and every ancestor is `min-h-*`, so `height: 100%` has nothing to resolve
 * against — which is why the full-page editor's `expand` mode cannot be reused.
 *
 * The measurement is taken when the editor opens and on resize, not on scroll:
 * the question is how much room there was where the editor sits, and the answer
 * must not change under the user as they scroll through what they are writing.
 * Setting the height does not move the element's own top edge, so this cannot
 * feed back into itself.
 */
export function useFillViewportHeight(enabled: boolean | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!enabled) {
      setHeight(undefined);
      return;
    }
    const measure = () => {
      const element = ref.current;
      if (!element) return;
      const { top } = element.getBoundingClientRect();
      // A negative top (the page is scrolled past the editor) would otherwise
      // ask for more than a screenful; the viewport is the ceiling either way.
      const available = Math.min(window.innerHeight - top, window.innerHeight) - BOTTOM_GAP;
      setHeight(Math.max(available, MIN_HEIGHT));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled]);

  return { ref, height, filling: enabled === true && height !== undefined };
}
