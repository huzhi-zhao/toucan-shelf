import { type Book, EpubCFI, type Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import { useCallback, useEffect, useRef, useState } from "react";
import { type EpubFlow, type EpubSettings, getBackgroundPreset, getFontPreset } from "./epubSettings";

export type { EpubFlow };

export const MIN_FONT_SCALE = 0.7;
export const MAX_FONT_SCALE = 2.0;
const FONT_STEP = 0.1;

// Reads the app's own theme tokens (set on :root by utils/theme.ts) so the book can match
// whatever theme is active — used for the "theme" background preset instead of a fixed color.
const readThemeColors = () => {
  const root = getComputedStyle(document.documentElement);
  const fg = root.getPropertyValue("--foreground").trim();
  const bg = root.getPropertyValue("--background").trim();
  return {
    fg: fg ? `hsl(${fg})` : "#1a1a1a",
    bg: bg ? `hsl(${bg})` : "#ffffff",
  };
};

// Pushes the reader's appearance settings into the rendition via themes.override, which
// sets each property (with !important) on every rendered view's <body> and re-applies to
// new pages automatically. Background/color inherit to text; font-family and letter-spacing
// likewise cascade. "theme" background defers to the app's current theme colors.
const applySettings = (rendition: Rendition, settings: EpubSettings) => {
  const bgPreset = getBackgroundPreset(settings.background);
  const { bg, fg } = bgPreset.bg && bgPreset.fg ? { bg: bgPreset.bg, fg: bgPreset.fg } : readThemeColors();
  rendition.themes.override("background", bg, true);
  rendition.themes.override("color", fg, true);

  const family = getFontPreset(settings.fontFamily).family;
  // Empty string clears the override so the book's own font-family applies again.
  rendition.themes.override("font-family", family ?? "", true);

  rendition.themes.override("letter-spacing", `${settings.letterSpacing}em`, true);
  rendition.themes.override("line-height", String(settings.lineHeight), true);
};

// epub.js renders each section into its own <iframe>; a Contents wraps that iframe's
// window/document. (epubjs' bundled types don't cover the bits we touch, so we narrow here.)
interface EpubContents {
  window: Window;
  document: Document;
}

// Where to float the "add note" button: the horizontal center of the selection's top edge,
// translated from the section iframe's coordinate space into `container`'s (the reading box).
const selectionAnchor = (contents: EpubContents, selection: Selection | null, container: HTMLElement | null) => {
  try {
    const iframe = contents.window.frameElement as HTMLElement | null;
    if (!selection || selection.rangeCount === 0 || !iframe || !container) return { x: 0, y: 0 };
    const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      x: iframeRect.left - containerRect.left + rangeRect.left + rangeRect.width / 2,
      y: iframeRect.top - containerRect.top + rangeRect.top,
    };
  } catch {
    return { x: 0, y: 0 };
  }
};

/** A mark to render in the book: the CFI range, its comment memo, and its visual style. */
export interface EpubHighlight {
  cfiRange: string;
  memoName: string;
  /** Concrete color for the highlight fill / underline stroke. */
  color: string;
  /** When true, render as an underline; otherwise as a background highlight. */
  underline: boolean;
}

interface Options {
  bookRef: React.MutableRefObject<Book | null>;
  ready: boolean;
  flow: EpubFlow;
  settings: EpubSettings;
  /** CFI to open on first display (e.g. restored from a scroll-position cache). */
  initialCfi?: string;
  /** Fired with the current location's CFI whenever the reader moves. */
  onLocationChange?: (cfi: string) => void;
  /** Existing highlights to render as clickable overlays. */
  highlights?: EpubHighlight[];
  /** When true, selecting text fires onSelected (to author a new annotation). */
  annotateMode?: boolean;
  /**
   * Fired when the reader finishes selecting text in annotate mode, with the CFI range,
   * the selected text, and the selection's anchor point in `containerRef` coordinates
   * (so the caller can float an "add note" button over it — mirroring the PDF reader).
   */
  onSelected?: (cfiRange: string, text: string, anchor: { x: number; y: number }) => void;
  /** Fired when the pending selection should be dismissed (reader pressed elsewhere / turned the page). */
  onSelectionCleared?: () => void;
  /** Fired when an existing highlight is clicked, with its comment memo name. */
  onHighlightClick?: (memoName: string, anchor: { x: number; y: number }) => void;
}

// Owns the epub.js Rendition: creates it into `containerRef`, applies the theme + font
// scale, and exposes navigation. The rendition is recreated when `flow` changes (epub.js
// can't switch flow modes on a live rendition).
export function useEpubRendition({
  bookRef,
  ready,
  flow,
  settings,
  initialCfi,
  onLocationChange,
  highlights,
  annotateMode,
  onSelected,
  onSelectionCleared,
  onHighlightClick,
}: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [displaying, setDisplaying] = useState(true);
  const onLocationChangeRef = useRef(onLocationChange);
  onLocationChangeRef.current = onLocationChange;
  // Callbacks/flags read inside long-lived epub.js event handlers, via refs so the
  // creation effect needn't re-run (and re-render the book) when they change.
  const annotateModeRef = useRef(annotateMode);
  annotateModeRef.current = annotateMode;
  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;
  const onSelectionClearedRef = useRef(onSelectionCleared);
  onSelectionClearedRef.current = onSelectionCleared;
  const onHighlightClickRef = useRef(onHighlightClick);
  onHighlightClickRef.current = onHighlightClick;
  // CFI ranges currently rendered as marks → their epub.js annotation type and a style
  // signature, so the sync effect can diff adds/removes and re-render on a recolor.
  const appliedHighlightsRef = useRef<Map<string, { type: "highlight" | "underline"; sig: string }>>(new Map());
  // Latest settings, so the rendition-creation effect can apply them without re-running
  // when settings change (a separate effect handles live updates).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Keep the latest CFI so a flow-mode recreate reopens where the reader was, and so we
  // don't re-apply the mount-time `initialCfi` after the reader has already moved.
  const currentCfiRef = useRef(initialCfi);

  useEffect(() => {
    const book = bookRef.current;
    const el = containerRef.current;
    if (!ready || !book || !el) return;

    setDisplaying(true);
    const rendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      flow,
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    applySettings(rendition, settingsRef.current);
    // Tint the native text selection light yellow (matching the saved-highlight color)
    // instead of the browser's default dark grey, so selecting text to annotate reads as
    // "about to highlight". Injected as a stylesheet into every rendered section iframe.
    rendition.themes.default({ "::selection": { "background-color": "rgba(255, 213, 74, 0.4)" } });

    const relocated = (location: { start?: { cfi?: string } }) => {
      // Turning the page invalidates any pending selection's anchor, so dismiss it.
      onSelectionClearedRef.current?.();
      const cfi = location.start?.cfi;
      if (cfi) {
        currentCfiRef.current = cfi;
        onLocationChangeRef.current?.(cfi);
      }
    };
    rendition.on("relocated", relocated);

    // Text selection → surface an "add note" button anchored over the selection (the caller
    // opens the editor when it's clicked). Only in annotate mode. We keep the browser
    // selection intact so the button has something to anchor to; it's cleared when the reader
    // presses elsewhere (the content hook below) or once the annotation is saved.
    const selected = (cfiRange: string, contents: EpubContents) => {
      if (!annotateModeRef.current) return;
      const selection = contents.window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!text) return;
      onSelectedRef.current?.(cfiRange, text, selectionAnchor(contents, selection, containerRef.current));
    };
    rendition.on("selected", selected);

    // Pointer-down inside the book's <iframe> doesn't reach the parent document, so two
    // things break unless we bridge it: the pending "add note" button never dismisses, and
    // Radix popovers/menus (e.g. the settings panel) never see the "click outside" and stay
    // open. Clear the selection, then re-dispatch a pointerdown on the iframe element (which
    // lives in the parent DOM) so dismissable layers close — matching the non-iframe PDF reader.
    const onBookPointerDown = (e: Event) => {
      onSelectionClearedRef.current?.();
      const iframe = (e as MouseEvent).view?.frameElement;
      iframe?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    };
    const onContent = (contents: EpubContents) => {
      contents.document.addEventListener("mousedown", onBookPointerDown);
    };
    rendition.hooks.content.register(onContent);

    // A fresh rendition renders no marks yet; let the sync effect re-add them all.
    appliedHighlightsRef.current = new Map();

    rendition.display(currentCfiRef.current || undefined).finally(() => setDisplaying(false));

    return () => {
      rendition.off("relocated", relocated);
      rendition.off("selected", selected);
      rendition.hooks.content.deregister(onContent);
      rendition.destroy();
      renditionRef.current = null;
    };
    // initialCfi intentionally omitted: only the mount-time value seeds currentCfiRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookRef, ready, flow]);

  // Re-apply font scale whenever it changes (and once the rendition exists).
  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${Math.round(fontScale * 100)}%`);
  }, [fontScale, displaying]);

  // Live-apply appearance settings (background/font/letter-spacing) as they change.
  useEffect(() => {
    if (renditionRef.current) applySettings(renditionRef.current, settings);
  }, [settings, displaying]);

  // Sync rendered marks with the annotations list (and after a fresh render). epub.js tracks
  // annotations per section and re-applies them as pages render, so we only add new/changed
  // CFI ranges and remove gone ones — diffed by a style signature so a recolor re-renders.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    // epub.js renders a "highlight" as an SVG <rect fill> and an "underline" as a <line
    // stroke>, so the color maps to a different attribute per type.
    const sig = (h: EpubHighlight) => `${h.underline ? "u" : "h"}:${h.color}`;
    const wanted = new Map((highlights ?? []).map((h) => [h.cfiRange, h]));
    const applied = appliedHighlightsRef.current;

    for (const [cfiRange, prev] of applied) {
      const next = wanted.get(cfiRange);
      if (next && sig(next) === prev.sig) continue;
      // Gone, or restyled — remove so it can be re-added with the new style below.
      rendition.annotations.remove(cfiRange, prev.type);
      applied.delete(cfiRange);
    }
    for (const [cfiRange, h] of wanted) {
      if (applied.has(cfiRange)) continue;
      const type = h.underline ? "underline" : "highlight";
      // A single-token className (marks-pane calls classList.add, which rejects spaces) lets
      // our parent-document CSS fix marks-pane's underline rendering (see index.css); the
      // color rides on the group's fill/stroke either way.
      const className = h.underline ? "epub-mark-ul" : "epub-mark-hl";
      const styles = h.underline
        ? { stroke: h.color, "stroke-opacity": "0.95" }
        : { fill: h.color, "fill-opacity": "0.32" };
      // The click cb is wired as a DOM listener by epub.js, so it receives the MouseEvent —
      // translate it to container coordinates so the caller can anchor the mark toolbar.
      const onClick = (e: Event) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const me = e as MouseEvent;
        const anchor = rect ? { x: me.clientX - rect.left, y: me.clientY - rect.top } : { x: 0, y: 0 };
        onHighlightClickRef.current?.(h.memoName, anchor);
      };
      try {
        rendition.annotations.add(type, cfiRange, { memoName: h.memoName }, onClick, className, styles);
        applied.set(cfiRange, { type, sig: sig(h) });
      } catch {
        // A malformed/stale CFI (e.g. from an edited book) can't be anchored — skip it.
      }
    }
  }, [highlights, displaying]);

  const next = useCallback(() => renditionRef.current?.next(), []);
  const prev = useCallback(() => renditionRef.current?.prev(), []);
  // Navigate to a TOC entry. epub.js matches spine items by their *full* href path, but a
  // TOC href is written relative to the TOC document's own location — so when the TOC lives
  // in a different folder than the content (e.g. `Text/toc.xhtml` linking to `chapter1.xhtml`
  // while the spine has `Text/chapter1.xhtml`), the paths don't match and display() silently
  // rejects. Fall back to matching on the filename (basename), preserving any `#fragment`.
  const goToHref = useCallback(
    (href: string) => {
      const rendition = renditionRef.current;
      const book = bookRef.current;
      if (!rendition || !book) return;
      rendition.display(href).catch(() => {
        const [path, fragment] = href.split("#");
        const filename = path.split("/").pop();
        let match: Section | undefined;
        book.spine.each((it: Section) => {
          if (!match && it.href?.split("/").pop() === filename) match = it;
        });
        if (match) rendition.display(fragment ? `${match.href}#${fragment}` : match.href);
      });
    },
    [bookRef],
  );
  const increaseFont = useCallback(() => setFontScale((s) => Math.min(MAX_FONT_SCALE, +(s + FONT_STEP).toFixed(2))), []);
  const decreaseFont = useCallback(() => setFontScale((s) => Math.max(MIN_FONT_SCALE, +(s - FONT_STEP).toFixed(2))), []);
  // Jump to a highlight's location when a comment is clicked in the sidebar. epub.js'
  // display() doesn't resolve a *range* CFI (`epubcfi(...,/1:0,/1:10)`) in a single pass —
  // it takes two calls to actually land — so collapse the range to its start point first.
  const goToCfi = useCallback((cfiRange: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    let target = cfiRange;
    try {
      const cfi = new EpubCFI(cfiRange);
      if (cfi.range) {
        cfi.collapse(true);
        target = cfi.toString();
      }
    } catch {
      // Not a parseable CFI range — fall back to displaying the raw value.
    }
    return rendition.display(target);
  }, []);

  return {
    containerRef,
    displaying,
    fontScale,
    next,
    prev,
    goToHref,
    goToCfi,
    increaseFont,
    decreaseFont,
  };
}
