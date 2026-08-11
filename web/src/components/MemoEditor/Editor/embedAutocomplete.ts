import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

export interface EmbedTarget {
  /** Root-relative document path (e.g. `/folder/doc`), inserted verbatim into `![[...]]`. */
  path: string;
  /** Document title, shown as the completion's display label. */
  title: string;
}

// Matches an in-progress `![[target` with no closing `]]` yet, from the start of the embed up to
// the cursor. `target` may be empty (the popup opens right after typing `![[`).
const EMBED_BEFORE = /!\[\[([^\]]*)$/;

export function makeEmbedCompletionSource(getDocuments: () => EmbedTarget[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(EMBED_BEFORE);
    if (!before) return null;
    const match = EMBED_BEFORE.exec(before.text);
    if (!match) return null;
    const typed = match[1].toLowerCase();
    const targetFrom = before.from + match.index + match[0].length - match[1].length;

    const options = getDocuments()
      .filter((doc) => doc.title.toLowerCase().includes(typed) || doc.path.toLowerCase().includes(typed))
      .slice(0, 50)
      .map((doc) => ({
        label: doc.title,
        detail: doc.path,
        apply: `${doc.path}]]`,
        type: "text",
      }));
    if (options.length === 0) return null;
    return { from: targetFrom, options };
  };
}
