import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorController, FormattingController } from "../types/editorController";

const isEmptyDoc = (state: EditorState) => state.doc.toString().trim() === "";

/** Block padding for insertMarkdown: ensure the inserted text is its own block. */
function blockPad(before: string, after: string): { prefix: string; suffix: string } {
  const prefix = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return { prefix, suffix };
}

export function createController(view: EditorView, formatting: FormattingController): EditorController {
  return {
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    isEmpty: () => isEmptyDoc(view.state),
    getMarkdown: () => view.state.doc.toString(),
    setMarkdown: (markdown) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } });
    },
    insertMarkdown: (markdown) => {
      if (!markdown) return;
      const { from, to } = view.state.selection.main;
      const doc = view.state.doc.toString();
      const { prefix, suffix } = blockPad(doc.slice(0, from), doc.slice(to));
      const insert = prefix + markdown + suffix;
      const caret = from + insert.length;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: caret }, scrollIntoView: true });
      view.focus();
    },
    replaceText: (search, replacement) => {
      if (!search) return;
      const doc = view.state.doc.toString();
      const index = doc.indexOf(search);
      if (index === -1) return;
      const from = index;
      const to = index + search.length;
      view.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length } });
    },
    getSelection: () => {
      const { from, to } = view.state.selection.main;
      return { from, to, text: view.state.sliceDoc(from, to), empty: from === to };
    },
    getSelectionCoords: () => {
      const { from, to } = view.state.selection.main;
      if (from === to) return null;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to, -1);
      if (!start || !end) return null;
      return {
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
      };
    },
    replaceSelection: (replacement) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return;
      view.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length } });
      view.focus();
    },
    replaceRange: (from, to, replacement) => {
      const max = view.state.doc.length;
      const start = Math.max(0, Math.min(from, max));
      const end = Math.max(start, Math.min(to, max));
      view.dispatch({ changes: { from: start, to: end, insert: replacement }, selection: { anchor: start + replacement.length } });
      view.focus();
    },
    scrollToCursor: () => view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) }),
    scrollToLine: (line) => {
      const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
      const pos = view.state.doc.line(clamped).from;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start" }) });
      view.focus();
    },
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (top) => {
      view.scrollDOM.scrollTop = top;
    },
    onScroll: (listener) => {
      const handler = () => listener(view.scrollDOM.scrollTop);
      view.scrollDOM.addEventListener("scroll", handler, { passive: true });
      return () => view.scrollDOM.removeEventListener("scroll", handler);
    },
    selectAll: () => view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }),
    formatting,
  };
}
