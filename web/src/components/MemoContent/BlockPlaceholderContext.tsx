import { createContext, type ReactNode, useContext } from "react";

/**
 * Lets a surface swap selected special code blocks (```kanban, ```sheets, …) for
 * a placeholder instead of rendering them. The mobile reader uses it for blocks a
 * phone cannot usefully show (docs/dev/requirements/mobile-reader.md §7).
 *
 * Absent — the web app — every block renders as before.
 */
export interface BlockPlaceholderContextValue {
  /** Fence languages (lower-case) to replace. */
  languages: ReadonlySet<string>;
  /** What to draw instead of the block. */
  render: (language: string) => ReactNode;
}

const BlockPlaceholderContext = createContext<BlockPlaceholderContextValue | null>(null);

export const BlockPlaceholderProvider = BlockPlaceholderContext.Provider;

export function useBlockPlaceholder(language: string): ReactNode | undefined {
  const value = useContext(BlockPlaceholderContext);
  if (!value || !value.languages.has(language)) return undefined;
  return value.render(language);
}
