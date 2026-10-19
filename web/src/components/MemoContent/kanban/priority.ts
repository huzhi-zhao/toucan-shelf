import type { Priority } from "./types";

// Tailwind classes per priority level, shared by the web board and the mobile
// reader's preview so a priority reads the same colour on both. Kept as a static
// map so the classes are visible to Tailwind's content scanner.
export const PRIORITY_BADGE: Record<Priority, string> = {
  highest: "bg-red-500/15 text-red-600 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  low: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  lowest: "bg-muted text-muted-foreground",
};
