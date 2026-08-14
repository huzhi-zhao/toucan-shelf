// Extended task checkbox statuses, following the convention shared by Obsidian's
// Tasks plugin and most "alternate checkbox" themes: the character inside the
// brackets carries the status, e.g. `- [/] doing`, `- [?] needs confirming`.
//
// GFM only understands `[ ]` and `[x]`; everything else is lifted out of the
// item text by remark-task-status and rendered as a status checkbox.

export type TaskStatusMarker = " " | "x" | "/" | "-" | "<" | ">" | "?" | "!";

export interface TaskStatusDefinition {
  marker: TaskStatusMarker;
  /** Marker characters that normalize to this status (e.g. `X` → `x`, `~` → `-`). */
  aliases: string[];
  labelKey: string;
  fallbackLabel: string;
  /**
   * Glyph drawn inside the box: an icon name (rendered as a lucide icon, which
   * centers cleanly) or a literal character for the punctuation statuses.
   */
  glyph: "" | "check" | "slash" | "minus" | "chevron-left" | "chevron-right" | "?" | "!";
  /** Content styling applied to the item text. */
  strikethrough?: boolean;
  muted?: boolean;
}

export const TASK_STATUSES: TaskStatusDefinition[] = [
  { marker: " ", aliases: [], labelKey: "markdown.task-status.todo", fallbackLabel: "Not started", glyph: "" },
  { marker: "x", aliases: ["X"], labelKey: "markdown.task-status.done", fallbackLabel: "Done", glyph: "check" },
  { marker: "/", aliases: [], labelKey: "markdown.task-status.in-progress", fallbackLabel: "In progress", glyph: "slash" },
  {
    marker: "-",
    aliases: ["~"],
    labelKey: "markdown.task-status.cancelled",
    fallbackLabel: "Cancelled",
    glyph: "minus",
    strikethrough: true,
    muted: true,
  },
  { marker: "<", aliases: [], labelKey: "markdown.task-status.scheduled", fallbackLabel: "Scheduled", glyph: "chevron-left" },
  { marker: ">", aliases: [], labelKey: "markdown.task-status.forwarded", fallbackLabel: "Deferred", glyph: "chevron-right" },
  { marker: "?", aliases: [], labelKey: "markdown.task-status.question", fallbackLabel: "Question", glyph: "?" },
  { marker: "!", aliases: [], labelKey: "markdown.task-status.important", fallbackLabel: "Important", glyph: "!" },
];

const BY_CHAR = new Map<string, TaskStatusDefinition>();
for (const status of TASK_STATUSES) {
  BY_CHAR.set(status.marker, status);
  for (const alias of status.aliases) {
    BY_CHAR.set(alias, status);
  }
}

/** Whether `char` is a recognized status marker. Unknown characters stay literal text. */
export function isTaskStatusMarker(char: string): boolean {
  return BY_CHAR.has(char);
}

/** Canonical status for a raw marker character; falls back to the unchecked status. */
export function resolveTaskStatus(char: string | undefined | null): TaskStatusDefinition {
  return (char !== undefined && char !== null && BY_CHAR.get(char)) || TASK_STATUSES[0];
}

/** Statuses that count as "the task is no longer open" for progress counts. */
export function isClosedTaskStatus(char: string): boolean {
  const marker = resolveTaskStatus(char).marker;
  return marker === "x" || marker === "-";
}
