import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";
import { alertDisplayLabel } from "./alertFamilies";

interface SpecialCalloutProps {
  family: string;
  /** The raw alias the author typed, e.g. "hint" under the "tip" family — used for the visible label. */
  rawType: string;
  /** Override from `[!TYPE(icon)]`; falls back to the family's default emoji. */
  customIcon?: string;
  /** Custom title typed after the `[!TYPE]` marker; falls back to `alertDisplayLabel(rawType)` where used. */
  title?: string;
  /** Default open state for collapsible families, from the `+`/`-` fold marker: "collapsed" | "expanded". */
  fold?: string;
  className?: string;
  children: React.ReactNode;
}

const CARD_BASE = "relative my-3 rounded-2xl border bg-card shadow-sm not-italic";

/** note: a rounded card with a filled pill "tag" floating over the top-left border. */
function NoteCard({ rawType, title, className, children }: SpecialCalloutProps) {
  return (
    <blockquote className={cn(CARD_BASE, "border-l-4 border-l-primary border-border px-5 pt-6 pb-4", className)}>
      <span className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-1 text-sm font-bold tracking-wide text-primary-foreground">
        {(title || alertDisplayLabel(rawType)).toUpperCase()}
      </span>
      <div className="min-w-0 leading-7">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
}

/** quote / cite: a plain oversized quote, no icon or label. */
function QuoteBox({ className, children }: SpecialCalloutProps) {
  return (
    <blockquote
      className={cn(
        "my-3 rounded-2xl border-l-4 border-l-indigo-500 bg-indigo-500/5 px-6 py-5 text-lg font-medium not-italic leading-relaxed text-foreground",
        className,
      )}
    >
      <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
    </blockquote>
  );
}

/** important: a "macOS window" card — traffic-light dots header, title, body. */
function WindowChromeCard({ rawType, title, className, children }: SpecialCalloutProps) {
  return (
    <blockquote className={cn(CARD_BASE, "overflow-hidden border-border p-0", className)}>
      <div className="flex items-center gap-3.5 border-b border-border bg-muted/60 px-4 py-3">
        <div className="flex gap-2">
          <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
          <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
          <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        </div>
        <span className="text-sm font-semibold text-muted-foreground">{title || alertDisplayLabel(rawType)}</span>
      </div>
      <div className="min-w-0 px-5 py-4 leading-7">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
}

/** summary / abstract / tldr: a card with a rounded "ribbon" badge in the top-right corner. */
function RibbonCard({ rawType, title, className, children }: SpecialCalloutProps) {
  return (
    <blockquote className={cn(CARD_BASE, "border-border px-5 pt-5 pb-4", className)}>
      <span className="absolute top-4 right-4 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-bold tracking-wide text-indigo-600 dark:text-indigo-300">
        {title || alertDisplayLabel(rawType)}
      </span>
      <div className="min-w-0 pr-16 leading-7">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
}

/** tip/hint, todo, attention: a shared skin — floating outlined pill label (emoji + word) over a colored left border. */
const MODERN_PILL_CONFIG: Record<string, { emoji: string; border: string; label: string }> = {
  tip: { emoji: "💡", border: "border-l-emerald-500", label: "border-emerald-500 text-emerald-600 dark:text-emerald-400" },
  todo: { emoji: "✅", border: "border-l-primary", label: "border-primary text-primary" },
  attention: { emoji: "❗", border: "border-l-amber-500", label: "border-amber-500 text-amber-600 dark:text-amber-400" },
};

function ModernCalloutPill({ family, rawType, customIcon, title, className, children }: SpecialCalloutProps) {
  const config = MODERN_PILL_CONFIG[family] ?? MODERN_PILL_CONFIG.tip;
  // tip/todo keep their fixed label regardless of any custom title typed after the marker;
  // attention is the only family in this shared component allowed to show a custom title.
  const label = family === "attention" ? title || alertDisplayLabel(rawType) : alertDisplayLabel(rawType);
  return (
    <blockquote className={cn(CARD_BASE, "border-l-4 border-border px-5 pt-6 pb-4", config.border, className)}>
      <span
        className={cn(
          "absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full border-2 bg-card px-3 py-0.5 text-xs font-bold",
          config.label,
        )}
      >
        <span aria-hidden>{customIcon || config.emoji}</span>
        {label}
      </span>
      <div className="min-w-0 leading-7">
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </div>
    </blockquote>
  );
}

/**
 * chat:s / chat:r: an iMessage-style speech bubble — outgoing bubbles are blue
 * and right-aligned, incoming ones grey and left-aligned, each with the curled
 * tail hooked onto its bottom corner. Not a card: the bubble hugs its text and
 * consecutive bubbles stack tightly so a `[!CHAT:…]` block reads as a thread.
 * The `[!CHAT:R(…)]` icon slot carries a sender/timestamp caption, tucked right
 * under the bubble and aligned to the bubble's own side.
 */
// Drawn 14x18 with the straight closing edge pushed *inside* the bubble, so the
// seam between tail and bubble body is covered even at the corner radius.
const CHAT_TAIL_PATH = "M14 2 C14 9 11 15 0.5 17.5 C6 17 10 16 14 14 Z";

function ChatBubble({ family, customIcon, className, children }: SpecialCalloutProps) {
  const sent = family === "chat-send";
  return (
    <div className={cn("my-0.5 flex flex-col", sent ? "items-end" : "items-start", className)}>
      <blockquote
        className={cn(
          // Paragraphs keep the global bottom margin, which reads as lopsided padding inside a bubble — drop it on the last one.
          "relative max-w-[78%] rounded-[18px] px-3.5 py-2 text-[15px] leading-snug not-italic break-words [&_p:last-child]:mb-0",
          sent ? "bg-[#248BF5] text-white" : "bg-[#E9E9EB] text-[#1c1c1e] dark:bg-[#3B3B3D] dark:text-white",
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 14 18"
          className={cn(
            "absolute bottom-0 h-[18px] w-[14px] fill-current",
            sent ? "right-[-6px] -scale-x-100 text-[#248BF5]" : "left-[-6px] text-[#E9E9EB] dark:text-[#3B3B3D]",
          )}
        >
          <path d={CHAT_TAIL_PATH} />
        </svg>
        <div className="relative min-w-0">
          <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
        </div>
      </blockquote>
      {customIcon && <span className="mt-px px-1.5 text-[10px] leading-4 text-muted-foreground">{customIcon}</span>}
    </div>
  );
}

/**
 * popover: the title renders as a pill button; hovering (or focusing) it reveals
 * the body in a floating panel anchored above the button. The body is always in
 * the DOM — only its visibility toggles — so it stays selectable and accessible.
 */
function PopoverCard({ rawType, title, className, children }: SpecialCalloutProps) {
  return (
    <span className={cn("group relative my-1 inline-flex not-italic", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1 text-sm font-medium text-foreground shadow-sm"
      >
        {title || alertDisplayLabel(rawType)}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-max max-w-sm rounded-xl border border-border bg-popover px-4 py-3 text-sm leading-6 text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
      >
        <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
      </span>
    </span>
  );
}

/**
 * collapse: a folding card — a title header with a chevron fold button, and, when
 * open, a rich body region below the divider. `[!Collapse]+` starts open,
 * `[!Collapse]-` (or no marker) starts folded.
 */
function CollapseCard({ rawType, title, fold, className, children }: SpecialCalloutProps) {
  const [open, setOpen] = useState(fold === "expanded");
  return (
    <blockquote className={cn(CARD_BASE, "border-border p-0 overflow-hidden", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-2 bg-muted/50 px-5 py-3 text-left text-base font-bold text-foreground",
          open && "border-b border-border",
        )}
      >
        <ChevronDownIcon className={cn("w-4 h-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <span className="min-w-0 truncate">{title || alertDisplayLabel(rawType)}</span>
      </button>
      {open && (
        <div className="min-w-0 px-5 py-4 leading-7">
          <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
        </div>
      )}
    </blockquote>
  );
}

const SPECIAL_CARD_COMPONENTS: Record<string, React.ComponentType<SpecialCalloutProps>> = {
  note: NoteCard,
  quote: QuoteBox,
  important: WindowChromeCard,
  summary: RibbonCard,
  tip: ModernCalloutPill,
  todo: ModernCalloutPill,
  attention: ModernCalloutPill,
  "chat-send": ChatBubble,
  "chat-recv": ChatBubble,
  collapse: CollapseCard,
  popover: PopoverCard,
};

/** Renders the bespoke card for a family in SPECIAL_CARD_FAMILIES; returns null if the family has no special card. */
export function renderSpecialCallout(props: SpecialCalloutProps): React.ReactElement | null {
  const Component = SPECIAL_CARD_COMPONENTS[props.family];
  return Component ? <Component {...props} /> : null;
}
