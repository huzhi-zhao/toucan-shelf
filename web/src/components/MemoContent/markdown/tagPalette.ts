// Color palette for `[!TAGS]` callouts (see remark-alert / TagRow in
// SpecialCallouts.tsx). Names follow the Arco Design tag palette so a `[blue]`
// or `[pinkpurple]` marker reads the same as in the design docs it comes from.
//
// Every class string is written out in full on purpose: Tailwind scans source
// text literally, so a composed `bg-${color}-500/10` would be purged from the
// build. Each color carries three skins — the tinted default, the outlined
// `bordered` variant and the solid `filled` one — chosen per block by the
// family suffix (`[!TAGS:bordered]`).
//
// This module is deliberately free of any block/blockquote knowledge so a
// future inline tag syntax (`:tag[Twitter]{color=blue}` via remark-directive)
// can render through the same palette and the same <Tag> markup.

export type TagVariant = "light" | "bordered" | "filled";

interface TagSkin {
  light: string;
  bordered: string;
  filled: string;
}

/** Palette name -> the three skins. `default` doubles as the fallback for unknown names. */
export const TAG_COLORS: Record<string, TagSkin> = {
  default: {
    light: "bg-muted text-muted-foreground",
    bordered: "border border-border text-muted-foreground",
    filled: "bg-muted-foreground text-background",
  },
  orangered: {
    light: "bg-red-500/10 text-red-600 dark:text-red-400",
    bordered: "border border-red-500 text-red-600 dark:text-red-400",
    filled: "bg-red-500 text-white",
  },
  orange: {
    light: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    bordered: "border border-orange-500 text-orange-600 dark:text-orange-400",
    filled: "bg-orange-500 text-white",
  },
  gold: {
    light: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    bordered: "border border-amber-500 text-amber-600 dark:text-amber-400",
    filled: "bg-amber-500 text-white",
  },
  lime: {
    light: "bg-lime-500/10 text-lime-600 dark:text-lime-400",
    bordered: "border border-lime-500 text-lime-600 dark:text-lime-400",
    filled: "bg-lime-500 text-white",
  },
  green: {
    light: "bg-green-500/10 text-green-600 dark:text-green-400",
    bordered: "border border-green-500 text-green-600 dark:text-green-400",
    filled: "bg-green-500 text-white",
  },
  cyan: {
    light: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    bordered: "border border-cyan-500 text-cyan-600 dark:text-cyan-400",
    filled: "bg-cyan-500 text-white",
  },
  blue: {
    light: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    bordered: "border border-sky-500 text-sky-600 dark:text-sky-400",
    filled: "bg-sky-500 text-white",
  },
  arcoblue: {
    light: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    bordered: "border border-blue-600 text-blue-600 dark:text-blue-400",
    filled: "bg-blue-600 text-white",
  },
  purple: {
    light: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    bordered: "border border-violet-500 text-violet-600 dark:text-violet-400",
    filled: "bg-violet-500 text-white",
  },
  pinkpurple: {
    light: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    bordered: "border border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400",
    filled: "bg-fuchsia-500 text-white",
  },
  magenta: {
    light: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    bordered: "border border-pink-500 text-pink-600 dark:text-pink-400",
    filled: "bg-pink-500 text-white",
  },
  gray: {
    light: "bg-muted text-muted-foreground",
    bordered: "border border-border text-muted-foreground",
    filled: "bg-slate-500 text-white",
  },
};

/** Palette names in menu/demo order — the Arco docs order, `default` first. */
export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);

/** Classes for a color name (any case); unknown names fall back to `default`, never to raw text. */
export function tagColorClasses(color: string | undefined, variant: TagVariant): string {
  const skin = TAG_COLORS[(color ?? "default").toLowerCase()] ?? TAG_COLORS.default;
  return skin[variant];
}
