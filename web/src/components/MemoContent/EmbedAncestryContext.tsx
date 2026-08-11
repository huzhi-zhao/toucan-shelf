import { createContext, type ReactNode, useContext } from "react";

/**
 * Hard cap on embed nesting depth, independent of cycle detection. Cycle detection alone only
 * catches a memo re-appearing in its own ancestry; this bounds worst-case render cost for very
 * long (but non-repeating) embed chains too.
 */
export const MAX_EMBED_DEPTH = 8;

/**
 * Resource names (`memos/{uid}`) of every document currently being rendered on the path from the
 * page's own document down to the current `<Embed>`, including the page document itself. An
 * `<Embed>` checks its resolved target against this list before fetching or recursing, so `A
 * embeds B embeds A` (or a document embedding itself) renders an inline notice instead of
 * recursing forever.
 */
const EmbedAncestryContext = createContext<string[]>([]);

export const EmbedAncestryProvider = ({ ancestry, children }: { ancestry: string[]; children: ReactNode }) => (
  <EmbedAncestryContext.Provider value={ancestry}>{children}</EmbedAncestryContext.Provider>
);

export const useEmbedAncestry = (): string[] => useContext(EmbedAncestryContext);
