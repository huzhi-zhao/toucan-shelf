declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  /** Bundles the plugins below: tables, strikethrough, task list items, highlighted code. */
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
  export const highlightedCodeBlock: TurndownService.Plugin;
}
