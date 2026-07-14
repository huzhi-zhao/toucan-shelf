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

/** quote / cite: a plain oversized italic quote, no icon or label. */
function QuoteBox({ className, children }: SpecialCalloutProps) {
  return (
    <blockquote
      className={cn(
        "my-3 rounded-2xl border-l-4 border-l-indigo-500 bg-indigo-500/5 px-6 py-5 text-lg italic leading-relaxed text-foreground",
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

const SPECIAL_CARD_COMPONENTS: Record<string, React.ComponentType<SpecialCalloutProps>> = {
  note: NoteCard,
  quote: QuoteBox,
  important: WindowChromeCard,
  summary: RibbonCard,
  tip: ModernCalloutPill,
  todo: ModernCalloutPill,
  attention: ModernCalloutPill,
};

/** Renders the bespoke card for a family in SPECIAL_CARD_FAMILIES; returns null if the family has no special card. */
export function renderSpecialCallout(props: SpecialCalloutProps): React.ReactElement | null {
  const Component = SPECIAL_CARD_COMPONENTS[props.family];
  return Component ? <Component {...props} /> : null;
}
