// Obsidian ships ~28 callout keywords grouped into a smaller set of visual
// families that share an icon/color — e.g. `success`, `check`, and `done` all
// render identically. This module is the single source of truth for that
// grouping, shared by the remark-alert dispatch (Alert.tsx) and the editor's
// callout insert menu.

/** Alias -> canonical family. Every key a `[!KEY]` marker can use. */
export const ALERT_FAMILY_ALIASES: Record<string, string> = {
  note: "note",
  quote: "quote",
  cite: "quote",
  important: "important",
  summary: "summary",
  abstract: "summary",
  tldr: "summary",
  tip: "tip",
  hint: "tip",
  info: "info",
  attention: "attention",
  example: "example",
  warning: "warning",
  todo: "todo",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  caution: "caution",
  danger: "danger",
  error: "danger",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  bug: "bug",
  aside: "aside",
};

/**
 * Families rendered as a bespoke "special card" (Note/Quote/Important/Summary/
 * ModernCalloutPill) instead of the plain colored-row style. An unrecognized
 * `[!TYPE]` resolves to "note", so it also lands here — matching Obsidian,
 * where an unknown callout still gets a real (default) look, never raw text.
 */
export const SPECIAL_CARD_FAMILIES = new Set(["note", "quote", "important", "summary", "tip", "info", "attention", "example", "warning"]);

/** Resolve a raw `[!TYPE]` string (any case) to its canonical family. Unknown types fall back to "note". */
export function resolveAlertFamily(rawType: string): string {
  return ALERT_FAMILY_ALIASES[rawType.toLowerCase()] ?? "note";
}

/** Capitalized label for display — preserves the *alias* the author typed (e.g. "Hint", not "Tip"). */
export function alertDisplayLabel(rawType: string): string {
  return rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
}
