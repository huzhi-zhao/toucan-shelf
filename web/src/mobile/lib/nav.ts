import { useCallback, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface NavState {
  backLabel?: string;
}

/**
 * Forward navigation with the push transition (requirement §8). `backLabel` is
 * the title of the page being left: like iOS, the next page's back button
 * names where it returns to.
 */
export function useGo(backLabel?: string) {
  const navigate = useNavigate();
  return useCallback(
    (to: string) => navigate(to, { viewTransition: true, state: backLabel ? ({ backLabel } satisfies NavState) : undefined }),
    [navigate, backLabel],
  );
}

/** The label the previous page left for this page's back button, if it was reached in-app. */
export function useBackLabel(): string | undefined {
  const { state } = useLocation();
  return (state as NavState | null)?.backLabel;
}

/**
 * The in-app back button. With history it steps back under the reverse
 * transition; opened from a deep link it goes to `fallback` instead.
 *
 * Safari's own edge-swipe never comes through here: the browser animates that
 * itself, and adding ours on top would play two animations.
 */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index === 0) {
      navigate(fallback, { replace: true, viewTransition: true });
      return;
    }
    if (!document.startViewTransition) {
      navigate(-1);
      return;
    }
    const root = document.documentElement;
    root.dataset.nav = "back";
    const before = window.location.href;
    const transition = document.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          navigate(-1);
          const started = performance.now();
          // popstate is asynchronous: hold the "after" snapshot until the URL
          // (and with it the rendered page) has actually changed.
          const wait = () => {
            if (window.location.href !== before || performance.now() - started > 300) {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            } else {
              requestAnimationFrame(wait);
            }
          };
          wait();
        }),
    );
    transition.finished.finally(() => {
      delete root.dataset.nav;
    });
  }, [navigate, fallback]);
}

const scrollPositions = new Map<string, number>();

/**
 * List pages scroll inside Konsta's Page element, which the router's own scroll
 * restoration cannot see; this keeps the position per history entry so going
 * back lands where the reader left.
 */
export function usePageScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { key } = useLocation();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = scrollPositions.get(key) ?? 0;
    const onScroll = () => scrollPositions.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key]);
  return ref;
}
