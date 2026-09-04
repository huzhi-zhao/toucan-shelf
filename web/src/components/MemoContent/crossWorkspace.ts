import { parseWorkspaceQualifiedHref } from "./DocumentLinkContext";

/**
 * Scans raw markdown for the destinations of workspace-qualified links
 * (`[x](@库标题/fb/dc.md)`, 库限定路径) and returns the distinct knowledge-base
 * titles they name.
 *
 * Deliberately matches link *destinations* only, not any "@" in the prose: a
 * bare "@handle" in a sentence must not turn into a lookup for a knowledge base
 * called "handle". This mirrors what the renderer will do — a title is
 * prefetched exactly when some `<Link>` is going to ask for it.
 *
 * The scan and the render must see the same content; both run off the same
 * `content` string in the same render pass.
 */
const LINK_DESTINATION_RE = /\]\(\s*<?(@[^)\s>]+)/g;

export function extractWorkspaceQualifiedTitles(content: string): string[] {
  if (!content.includes("](@")) return [];
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(LINK_DESTINATION_RE)) {
    const parsed = parseWorkspaceQualifiedHref(match[1]);
    if (!parsed) continue;
    const key = parsed.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(parsed.title);
  }
  return titles;
}
