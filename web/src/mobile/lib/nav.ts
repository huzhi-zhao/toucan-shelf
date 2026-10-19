import { useCallback, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface NavState {
  backLabel?: string;
}

/**
 * Runs a route change under a page transition (requirement §8): `forward` slides
 * the new page in from the right, `back` slides the current one off to the right.
 *
 * The transition is started here, never through React Router's `viewTransition`
 * option. The router remembers every route pair it animated and replays a
 * transition when the browser later pops between them; Safari's edge swipe has
 * already animated that pop, and the replay (always the forward animation, as
 * the router knows nothing of `data-nav`) made going back look like arriving at
 * a new page.
 */
export function navigateWithTransition(change: () => void, direction: "forward" | "back") {
  if (!document.startViewTransition) {
    change();
    return;
  }
  const root = document.documentElement;
  if (direction === "back") root.dataset.nav = "back";
  const transition = document.startViewTransition(
    () =>
      // Hold the "after" snapshot until the new route has committed to the DOM
      // (`useRouteCommitSignal`). Never wait on requestAnimationFrame here:
      // rendering is paused while this callback is pending, WebKit runs no frame
      // callbacks then, and the transition would hang until the browser's own
      // timeout (about four seconds). The timer covers a change that commits nothing.
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          if (pendingCommit === finish) pendingCommit = null;
          resolve();
        };
        const timer = setTimeout(finish, COMMIT_TIMEOUT_MS);
        pendingCommit = finish;
        change();
      }),
  );
  transition.finished.finally(() => {
    delete root.dataset.nav;
  });
}

const COMMIT_TIMEOUT_MS = 500;
let pendingCommit: (() => void) | null = null;

/**
 * Tells a running page transition that the new route is in the DOM. Mount once,
 * inside the router: a layout effect runs right after React commits, before paint.
 */
export function useRouteCommitSignal() {
  const { key } = useLocation();
  useLayoutEffect(() => {
    pendingCommit?.();
  }, [key]);
}

/**
 * The router's record of animated route pairs lives in sessionStorage, so a tab
 * opened before transitions moved out of the router would keep replaying them.
 * Call before the router is created.
 */
export function forgetRouterTransitions() {
  try {
    sessionStorage.removeItem("remix-router-transitions");
  } catch {
    // Storage blocked: the router has nothing to restore either.
  }
}

/**
 * Forward navigation with the push transition. `backLabel` is the title of the
 * page being left: like iOS, the next page's back button names where it returns to.
 */
export function useGo(backLabel?: string) {
  const navigate = useNavigate();
  return useCallback(
    (to: string) =>
      navigateWithTransition(
        () => navigate(to, { flushSync: true, state: backLabel ? ({ backLabel } satisfies NavState) : undefined }),
        "forward",
      ),
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
      navigateWithTransition(() => navigate(fallback, { replace: true, flushSync: true }), "back");
      return;
    }
    navigateWithTransition(() => navigate(-1), "back");
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

const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

// Where the shelf tab sits in this tab's history. Tabs replace each other in place, so the shelf keeps one
// entry until another tab takes it over; the tab layout keeps this current.
let shelfHistoryIndex: number | undefined;

/** Called by the tab layout on every tab page: notes where the shelf is, or that it was replaced. */
export function noteTabHistory(isShelf: boolean) {
  const index = historyIndex();
  if (isShelf) shelfHistoryIndex = index;
  else if (shelfHistoryIndex === index) shelfHistoryIndex = undefined;
}

/**
 * "Back to the shelf" from deep in a knowledge base. When the shelf is further back in history it steps all
 * the way back to it, so the folders in between leave the stack and an edge swipe from the shelf does not
 * land in them again; reached any other way (a deep link), it replaces the current page with the shelf.
 */
export function useBackToShelf(shelfPath: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = historyIndex();
    if (shelfHistoryIndex !== undefined && shelfHistoryIndex < index) {
      const steps = shelfHistoryIndex - index;
      navigateWithTransition(() => navigate(steps), "back");
      return;
    }
    navigateWithTransition(() => navigate(shelfPath, { replace: true, flushSync: true }), "back");
  }, [navigate, shelfPath]);
}
