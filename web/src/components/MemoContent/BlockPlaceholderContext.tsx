import { createContext, type ReactNode, useContext } from "react";

/**
 * Lets a surface swap selected special code blocks (```kanban, ```sheets, …) for
 * its own rendering instead of the default one. The mobile reader uses it for a
 * placeholder where a phone cannot usefully show a block, and for its own
 * read-only take on the ones it can (docs/dev/requirements/mobile-reader.md §7,
 * mobile-phase3.md §4).
 *
 * Absent — the web app — every block renders as before.
 */
export interface BlockPlaceholderContextValue {
  /** Fence languages (lower-case) to replace. */
  languages: ReadonlySet<string>;
  /** What to draw instead of the block. `content` is the fence body. */
  render: (language: string, content: string) => ReactNode;
}

const BlockPlaceholderContext = createContext<BlockPlaceholderContextValue | null>(null);

export const BlockPlaceholderProvider = BlockPlaceholderContext.Provider;

export function useBlockPlaceholder(language: string, content: string): ReactNode | undefined {
  const value = useContext(BlockPlaceholderContext);
  if (!value || !value.languages.has(language)) return undefined;
  return value.render(language, content);
}
