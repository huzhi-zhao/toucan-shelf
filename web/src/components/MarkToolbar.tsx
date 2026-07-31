import { EraserIcon, MessageSquarePlusIcon, TextSelectIcon, UnderlineIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { MARK_COLORS } from "@/utils/markColors";

interface Props {
  /** Position (in the containing positioned element's coordinates) to anchor the toolbar over. */
  x: number;
  y: number;
  /** The mark's current background color key ("" = none), so the active swatch is ringed. */
  activeColorKey: string;
  /** Whether the mark currently has an underline, so the underline button reads as toggled on. */
  activeUnderline: boolean;
  onColor: (colorKey: string) => void;
  onUnderline: () => void;
  onNote: () => void;
  /**
   * Re-pick which text this mark covers. Omitted for a fresh selection, which is still being
   * pointed at the text it wants. A mark's extent is otherwise fixed at the moment it is made —
   * grabbing one word too few, or a trailing bracket too many, meant deleting the mark (and any
   * note on it) and starting over.
   */
  onRelink?: () => void;
  /** Clear this mark's styling. Omitted for a fresh selection (nothing to clear yet). */
  onClear?: () => void;
}

// The floating mark toolbar, shown both when finishing a text selection (to create a mark) and
// when clicking an existing mark (to restyle it): a note button, six background colors, and an
// underline toggle. Background and underline are independent — a mark can carry both — so the
// active swatch is ringed and the underline button reflects its on/off state.
// onMouseDown-preventDefault keeps the text selection from collapsing before the click lands.
//
// Shared by every surface that supports marking text (EPUB attachments and notebook documents),
// so marking feels identical wherever it happens. It keeps the `epub.*` translation keys it was
// born with rather than renaming them to something neutral: the strings themselves are generic
// ("Highlight", "Underline"), and they are already translated into every supported locale.
// Marks the toolbar's own subtree. Surfaces that dismiss the toolbar on a click in the document
// must skip events coming from here: the toolbar prevents its mouse-down (to keep the selection
// alive), but mouse-up still bubbles, and dismissing on it would unmount the toolbar before the
// browser gets to dispatch the click to the button that was pressed.
export const MARK_TOOLBAR_ATTR = "data-mark-toolbar";

/** Roughly the toolbar's own height, used to decide whether it fits above the mark. */
const TOOLBAR_HEIGHT = 36;
/** How far below the mark's top edge the flipped toolbar sits — clear of a normal line of text. */
const FLIPPED_OFFSET = 26;
/** Gap kept between the toolbar and its container's left/right edge when the anchor is off to one side. */
const EDGE_PADDING = 8;

export const MarkToolbar = ({ x, y, activeColorKey, activeUnderline, onColor, onUnderline, onNote, onRelink, onClear }: Props) => {
  const t = useTranslate();
  // The toolbar normally sits above the mark. Near the top of the document there is no room for
  // it there — it would be clipped by the scroll container — so it flips below instead.
  const flip = y < TOOLBAR_HEIGHT + 8;

  // The toolbar is centred on the mark (-translate-x-1/2), so a selection near the container's
  // left edge would push its first buttons outside — and out of sight, since the container clips.
  // Measure once the toolbar is laid out and slide it back inside; the anchor `x` itself is left
  // alone so nothing else has to know about the nudge.
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  useLayoutEffect(() => {
    const element = ref.current;
    const container = element?.offsetParent as HTMLElement | null;
    if (!element || !container) {
      setLeft(x);
      return;
    }
    const half = element.offsetWidth / 2;
    const min = EDGE_PADDING + half;
    const max = container.clientWidth - EDGE_PADDING - half;
    // A container narrower than the toolbar has no valid range — centre it and let it overflow evenly.
    setLeft(max < min ? container.clientWidth / 2 : Math.min(Math.max(x, min), max));
  }, [x]);

  return (
    <div
      ref={ref}
      {...{ [MARK_TOOLBAR_ATTR]: "" }}
      className={cn(
        "absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-md",
        !flip && "-translate-y-full",
      )}
      style={{ left, top: flip ? y + FLIPPED_OFFSET : y - 6 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button variant="ghost" size="icon" className="h-7 w-7" title={t("epub.add-annotation")} onClick={onNote}>
        <MessageSquarePlusIcon className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-0.5 h-5 w-px bg-border" />
      {MARK_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          title={t("epub.highlight")}
          aria-label={c.key}
          className={cn(
            "h-5 w-5 rounded-full border transition-transform hover:scale-110",
            activeColorKey === c.key ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover border-transparent" : "border-black/10",
          )}
          style={{ backgroundColor: c.color }}
          onClick={() => onColor(c.key)}
        />
      ))}
      <div className="mx-0.5 h-5 w-px bg-border" />
      <Button
        variant={activeUnderline ? "secondary" : "ghost"}
        size="icon"
        className="h-7 w-7"
        title={t("epub.underline")}
        onClick={onUnderline}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </Button>
      {onRelink && (
        <Button variant="ghost" size="icon" className="h-7 w-7" title={t("mark.relink")} onClick={onRelink}>
          <TextSelectIcon className="h-3.5 w-3.5" />
        </Button>
      )}
      {onClear && (
        <Button variant="ghost" size="icon" className="h-7 w-7" title={t("epub.clear-mark")} onClick={onClear}>
          <EraserIcon className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};
