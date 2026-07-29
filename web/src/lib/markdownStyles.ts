import { BugIcon, CheckIcon, CircleHelpIcon, InfoIcon, type LucideIcon, PencilIcon, TriangleAlertIcon, XIcon, ZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Per-level heading classes (size / weight / border), matching MemoContent. */
const headingLevelClasses: Record<HeadingLevel, string> = {
  1: "text-3xl font-bold border-b border-border pb-2",
  2: "text-2xl font-semibold border-b border-border pb-1.5",
  3: "text-xl font-semibold",
  4: "text-lg font-semibold",
  5: "text-base font-semibold",
  6: "text-base font-medium text-muted-foreground",
};

/** Shared base classes applied to every heading level. */
const headingBaseClasses = "mt-3 mb-2 leading-tight";

/**
 * Complete heading class per level, precomputed once at module load (base +
 * per-level). headingClass is a hot path — MemoContent renders it per heading
 * on every content render — so the cn() merge happens here, not per call.
 */
const headingClasses: Record<HeadingLevel, string> = {
  1: cn(headingBaseClasses, headingLevelClasses[1]),
  2: cn(headingBaseClasses, headingLevelClasses[2]),
  3: cn(headingBaseClasses, headingLevelClasses[3]),
  4: cn(headingBaseClasses, headingLevelClasses[4]),
  5: cn(headingBaseClasses, headingLevelClasses[5]),
  6: cn(headingBaseClasses, headingLevelClasses[6]),
};

/**
 * Single source of truth for the styling of common markdown elements rendered
 * by the read-only memo view (MemoContent). Each value is a complete, standalone
 * Tailwind class string so it can be dropped onto a DOM element as-is (MemoContent
 * merges them with `cn`). The editor does not use these — it styles its raw
 * markdown source via CodeMirror decorations in `MemoEditor/Editor/theme.ts`.
 *
 * These are static string literals so Tailwind's JIT scanner detects them.
 */
export const markdownStyles = {
  paragraph: "my-0 mb-2 leading-6",
  blockquote: "my-0 mb-2 border-l-4 border-primary/30 pl-3 not-italic font-medium text-foreground/85",
  bulletList: "my-0 mb-2 list-outside pl-6 list-disc",
  orderedList: "my-0 mb-2 list-outside pl-6 list-decimal",
  listItem: "mt-0.5 leading-6",
  // Shared by the read-only task item (MemoContent/markdown/List.tsx) and the
  // editor so the checkbox + text grid stays identical in both.
  taskListItem: "mt-0.5 min-w-0 leading-6 list-none grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 [&>[data-slot=checkbox]]:mt-[3px]",
  taskItemContent: "min-w-0 [overflow-wrap:anywhere] [&>*:last-child]:mb-0",
  inlineCode: "font-mono text-sm bg-muted px-1 py-0.5 rounded-md",
  link: "text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:decoration-primary",
  horizontalRule: "my-2 h-0 border-0 border-b border-border",
} as const;

/** Complete heading class for a given level (shared base + per-level classes). */
export const headingClass = (level: HeadingLevel): string => headingClasses[level];

/**
 * Tag pill styling for the read-only memo view (MemoContent/Tag.tsx). Split into
 * two tokens so the viewer can swap `defaultColor` for an inline custom color.
 * (The editor does not use these; it colors `#tag` source via the
 * `cm-memo-tag` decoration in Editor/theme.ts.)
 */
export const tagStyles = {
  /** Shape, padding, and typography — always applied. */
  base: "inline-flex items-center align-baseline px-1.5 py-0.5 text-[0.9em] leading-none font-normal rounded-full border",
  /** Default theme color, used when no custom tag color is set. */
  defaultColor: "border-primary text-primary bg-primary/15",
} as const;

/**
 * `@mention` styling for the read-only memo view (MemoContent/Mention.tsx).
 * Unlike a tag this is not a pill — it is a primary-colored accent (the read-only
 * view adds `hover:underline` for its link). (The editor does not use these; it
 * colors `@mention` source via the `cm-memo-mention` decoration in
 * Editor/theme.ts.)
 */
export const mentionStyles = {
  base: "text-primary underline-offset-2",
} as const;

/**
 * "Simple tier" alert callout styling for the read-only memo view
 * (MemoContent/markdown/Alert.tsx) — a saturated pastel card (tinted bg + solid
 * left border + bold icon/label header), used for families that don't have a
 * bespoke card design. Keyed by canonical family (see alertFamilies.ts), not by
 * every alias. `[!TYPE(icon)]` in the source overrides the icon only, colors
 * stay tied to the family. Every family gets its own hue so the callouts stay
 * visually distinct even without a unique layout.
 */
export const alertStyles: Record<string, { icon: LucideIcon | string; classes: string }> = {
  info: { icon: InfoIcon, classes: "bg-sky-100 dark:bg-sky-500/15 border-l-sky-600 dark:border-l-sky-400 text-sky-900 dark:text-sky-100" },
  aside: {
    icon: PencilIcon,
    classes: "bg-slate-100 dark:bg-slate-500/15 border-l-slate-600 dark:border-l-slate-400 text-slate-900 dark:text-slate-100",
  },
  success: {
    icon: CheckIcon,
    classes: "bg-emerald-100 dark:bg-emerald-500/15 border-l-emerald-600 dark:border-l-emerald-400 text-emerald-900 dark:text-emerald-100",
  },
  question: {
    icon: CircleHelpIcon,
    classes: "bg-violet-100 dark:bg-violet-500/15 border-l-violet-600 dark:border-l-violet-400 text-violet-900 dark:text-violet-100",
  },
  example: {
    icon: "🌰",
    classes: "bg-amber-100 dark:bg-amber-500/15 border-l-amber-600 dark:border-l-amber-400 text-amber-900 dark:text-amber-100",
  },
  caution: {
    icon: TriangleAlertIcon,
    classes: "bg-yellow-100 dark:bg-yellow-500/15 border-l-yellow-600 dark:border-l-yellow-400 text-yellow-900 dark:text-yellow-100",
  },
  warning: {
    icon: TriangleAlertIcon,
    classes: "bg-orange-100 dark:bg-orange-500/15 border-l-orange-600 dark:border-l-orange-400 text-orange-900 dark:text-orange-100",
  },
  danger: { icon: ZapIcon, classes: "bg-red-100 dark:bg-red-500/15 border-l-red-600 dark:border-l-red-400 text-red-900 dark:text-red-100" },
  failure: {
    icon: XIcon,
    classes: "bg-rose-100 dark:bg-rose-500/15 border-l-rose-600 dark:border-l-rose-400 text-rose-900 dark:text-rose-100",
  },
  bug: { icon: BugIcon, classes: "bg-pink-100 dark:bg-pink-500/15 border-l-pink-600 dark:border-l-pink-400 text-pink-900 dark:text-pink-100" },
} as const;
