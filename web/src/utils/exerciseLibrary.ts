import { parseFrontmatter } from "@/utils/frontmatter";

/**
 * The exercise library (requirement §2.4.4, ADR 0023): the user's documents with `kind: exercise` in their
 * frontmatter, one guide per exercise. A guide's resource name is the exercise's identity; a workout's
 * exercise links it through `doc`.
 */
export interface ExerciseGuide {
  /** `memos/{uid}`. */
  name: string;
  title: string;
  /** "" when the guide names none. */
  group: string;
  /** Other names the exercise goes by, for search. */
  aliases: string[];
}

/** The filter text that narrows the server's list to likely guides; `guideOf` then reads each one properly. */
export const EXERCISE_KIND_FILTER = 'content.contains("kind: exercise")';

/** The groups in the order they are listed; any other group comes after them, by name. */
export const EXERCISE_GROUP_ORDER = ["腿臀", "推", "拉", "核心"];

/** A document as a guide, or undefined when its frontmatter does not say `kind: exercise`. */
export function guideOf(memo: { name: string; title: string; content: string }): ExerciseGuide | undefined {
  const properties = parseFrontmatter(memo.content).properties;
  const value = (key: string) => properties.find((p) => p.key === key)?.value;
  if (value("kind") !== "exercise") return undefined;
  const group = value("group");
  const aliases = value("aliases");
  return {
    name: memo.name,
    title: memo.title,
    group: typeof group === "string" ? group.trim() : "",
    aliases: Array.isArray(aliases) ? aliases : typeof aliases === "string" && aliases ? [aliases] : [],
  };
}

/** Whether a guide matches a search: its title or an alias contains the text, ignoring case. */
export function guideMatches(guide: ExerciseGuide, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [guide.title, ...guide.aliases].some((text) => text.toLowerCase().includes(q));
}

/** Guides by group, groups in EXERCISE_GROUP_ORDER then by name (no group last), titles in order within. */
export function groupGuides(guides: ExerciseGuide[]): { group: string; guides: ExerciseGuide[] }[] {
  const byGroup = new Map<string, ExerciseGuide[]>();
  for (const guide of guides) byGroup.set(guide.group, [...(byGroup.get(guide.group) ?? []), guide]);
  const rank = (group: string) => {
    const known = EXERCISE_GROUP_ORDER.indexOf(group);
    if (known >= 0) return known;
    return group ? EXERCISE_GROUP_ORDER.length : EXERCISE_GROUP_ORDER.length + 1;
  };
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "zh"))
    .map(([group, list]) => ({ group, guides: [...list].sort((a, b) => a.title.localeCompare(b.title, "zh")) }));
}
