import type { ActiveFormatState, EditorCommandContext, EditorCommandId } from "../formatting/commands";

/**
 * The contract the memo editor (Editor) implements. Everything outside the
 * editor implementation talks markdown through this interface and never reaches
 * for the editor's internal CodeMirror/DOM APIs.
 */
export interface EditorController {
  focus(): void;
  hasFocus(): boolean;
  /** Whitespace-only content counts as empty. */
  isEmpty(): boolean;
  /** Current document as a markdown string (the only storage format). */
  getMarkdown(): string;
  /** Replace the whole document from a markdown string. */
  setMarkdown(markdown: string): void;
  /** Insert markdown at the cursor as its own block. */
  insertMarkdown(markdown: string): void;
  /** Replace the first occurrence of `search` in the document with `replacement`, if present. */
  replaceText(search: string, replacement: string): void;
  scrollToCursor(): void;
  /** Move the cursor to the start of a 1-indexed line and scroll it into view (e.g. outline navigation). */
  scrollToLine(line: number): void;
  /** Current pixel scroll offset of the editor's scrollable content (e.g. for a scroll-position cache). */
  getScrollTop(): number;
  /** Set the editor's scroll offset directly, without moving the cursor (e.g. restoring a cached position). */
  setScrollTop(top: number): void;
  /** Registers a listener fired on every scroll of the editor's content. Returns an unsubscribe. */
  onScroll(listener: (top: number) => void): () => void;
  /** Select the entire document (used by tests and select-all flows). */
  selectAll(): void;
  /**
   * Rich-formatting capability driving the focus-mode FormattingToolbar.
   * Editor always sets it; the field is optional so the contract stays
   * decoupled from any one editor implementation.
   */
  formatting?: FormattingController;
}

/**
 * Rich-formatting surface, backed by the editor command catalog
 * (formatting/commands.ts). `getActiveFormats` is the sanctioned, typed place
 * editor state crosses the boundary — the editor's internal node/mark names
 * never leak out as stringly-typed `isActive(name)` calls.
 */
export interface FormattingController {
  /** Run a catalog command (e.g. "bold", "heading2", "link"). */
  run(command: EditorCommandId, ctx?: EditorCommandContext): void;
  /** Snapshot of which marks/blocks are active at the current selection. */
  getActiveFormats(): ActiveFormatState;
  /** Register a listener fired on every transaction/selection change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}
