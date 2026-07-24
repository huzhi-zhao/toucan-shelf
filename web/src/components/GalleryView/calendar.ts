import dayjs from "dayjs";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import type { MemoProperty } from "@/utils/frontmatter";
import { propertyValueToString } from "./fields";
import type { CalendarLayoutBlock } from "./types";

// The property key a document's date is written to when the block has no
// explicit `dateProperty` configured (creation-date mode). New documents always
// carry an explicit date so they land on the day they were added, even when the
// block otherwise buckets by creation date.
export const DEFAULT_DATE_PROPERTY = "date";

// Named colors a document's `color` property may use, mapped to the shared
// calendar palette hues. Unknown names fall through to a raw CSS color (a hex
// value, or any valid CSS color keyword).
const NAMED_COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  yellow: "#eab308",
  purple: "#a855f7",
  pink: "#ec4899",
  teal: "#14b8a6",
  orange: "#f97316",
  gray: "#9ca3af",
  grey: "#9ca3af",
};

/**
 * The tile-bar color for a document, from its `color` frontmatter property, or
 * undefined when it has none. A known color name resolves to the palette hue;
 * anything else (a hex code or CSS keyword) is used as-is.
 */
export function docColor(props: Map<string, MemoProperty>): string | undefined {
  const prop = props.get("color");
  const raw = prop ? propertyValueToString(prop).trim() : "";
  if (!raw) return undefined;
  return NAMED_COLORS[raw.toLowerCase()] ?? raw;
}

/** The frontmatter key the calendar reads (and writes) a document's date to. */
export function calendarDatePropertyKey(block: CalendarLayoutBlock): string {
  return block.dateProperty.trim() || DEFAULT_DATE_PROPERTY;
}

// Normalizes a raw property value to a `YYYY-MM-DD` string, or undefined when it
// isn't a parseable date.
function normalizeDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : undefined;
}

/**
 * Resolves the calendar date (`YYYY-MM-DD`) a document is bucketed onto, or
 * undefined when it has none. With a configured `dateProperty`, only that
 * property counts (documents lacking it don't appear). Without one, a `date`
 * property wins if present, else the document's creation date.
 */
export function docCalendarDate(doc: Memo, props: Map<string, MemoProperty>, block: CalendarLayoutBlock): string | undefined {
  const configured = block.dateProperty.trim();
  if (configured) {
    const prop = props.get(configured);
    return prop ? normalizeDate(propertyValueToString(prop)) : undefined;
  }
  const dateProp = props.get(DEFAULT_DATE_PROPERTY);
  if (dateProp) {
    const norm = normalizeDate(propertyValueToString(dateProp));
    if (norm) return norm;
  }
  return doc.createTime ? dayjs(Number(doc.createTime.seconds) * 1000).format("YYYY-MM-DD") : undefined;
}

/**
 * Builds the folder and content for a document created from the calendar's add
 * button, so the block's own scope will pick it up on `date`: the date property
 * is written and every property/tag rule is reproduced as frontmatter / a
 * hashtag. The folder is taken from the block's explicit `newDocFolder` when
 * set; otherwise it falls back to the scope's first folder rule, then the
 * view's own folder.
 */
export function newCalendarDoc(
  block: CalendarLayoutBlock,
  viewFolderPath: string,
  date: string,
  title: string,
): { folderPath: string; content: string } {
  const props: [string, string][] = [[calendarDatePropertyKey(block), date]];
  const tags: string[] = [];
  // An explicit target folder pins the location; when it's empty we fall back to
  // the first folder rule below, else the view's own folder.
  const explicitFolder = block.newDocFolder.trim().replace(/^\/+|\/+$/g, "");
  let folderPath = explicitFolder || viewFolderPath;
  let folderRuleSeen = Boolean(explicitFolder);

  for (const group of block.scope.groups) {
    for (const rule of group.rules) {
      if (rule.kind === "folder") {
        // Only the first folder rule steers where the doc is created.
        if (!folderRuleSeen) {
          if (rule.path?.trim()) folderPath = rule.path.trim().replace(/^\/+|\/+$/g, "");
          folderRuleSeen = true;
        }
      } else if (rule.kind === "property") {
        if (rule.key && !props.some(([k]) => k === rule.key)) props.push([rule.key, rule.value]);
      } else if (rule.kind === "tag") {
        if (rule.tag && !tags.includes(rule.tag)) tags.push(rule.tag);
      }
    }
  }

  const frontmatter = props.map(([k, v]) => `${k}: ${v}`).join("\n");
  // Tags are sourced from #hashtags in the body, so reproduce tag rules there.
  const body = [`# ${title}`, ...(tags.length ? [tags.map((tag) => `#${tag}`).join(" ")] : [])].join("\n\n");
  return { folderPath, content: `---\n${frontmatter}\n---\n${body}\n` };
}
