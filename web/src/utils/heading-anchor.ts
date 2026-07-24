// Heading anchor id generation and tolerant link resolution.
//
// Heading ids are human-readable slugs (see `slugify`), which keeps URLs shareable and
// backward compatible. The trouble is that a cross-document link is usually authored with the
// *raw* heading text in its fragment — `document/abc#h-82年，🔥了，【Fire，fire】` — while the
// rendered id is the slugified form (`82年了firefire`). The two never string-match, so the jump
// silently fails.
//
// The fix is to resolve links by re-running the *same* slugify on the fragment. Because slugify
// is idempotent (`slugify(slugify(x)) === slugify(x)`), one path handles both authoring styles:
// the raw title and an already-slugified anchor both reduce to the canonical id. No opaque hash
// ids, no id-scheme migration.

import { slugify } from "./markdown-manipulation";

export { headingSlug } from "./markdown-manipulation";

/**
 * Ordered candidate ids to try for a raw link fragment (the part after `#`, possibly
 * percent-encoded, possibly written as raw heading text with punctuation/emoji, and possibly
 * prefixed with `h-`). Exact match first so existing footnote/precise anchors keep priority.
 */
export function headingIdCandidates(rawFragment: string): string[] {
  let frag = rawFragment;
  try {
    frag = decodeURIComponent(rawFragment);
  } catch {
    // Malformed percent-encoding — fall back to the raw value.
  }
  const candidates = new Set<string>();
  const add = (value: string) => {
    if (value) candidates.add(value);
  };

  add(frag); // exact id: footnotes, already-correct anchors
  add(slugify(frag)); // raw title OR already-slugified anchor → canonical id (slugify is idempotent)
  // Some authoring tools prefix heading anchors with `h-`; strip it and retry.
  if (frag.startsWith("h-")) {
    const stripped = frag.slice(2);
    add(stripped);
    add(slugify(stripped));
  }
  return [...candidates];
}

/**
 * Resolve a raw link fragment to a rendered element within `root` (a container element or
 * `document`), tolerant of anchors written as raw heading text. Returns null when nothing matches.
 */
export function resolveHeadingTarget(root: ParentNode | null | undefined, rawFragment: string): HTMLElement | null {
  if (!root || !rawFragment) return null;
  for (const id of headingIdCandidates(rawFragment)) {
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el) return el;
  }
  return null;
}
