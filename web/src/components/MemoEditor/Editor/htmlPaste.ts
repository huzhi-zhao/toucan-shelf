import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { htmlToMarkdown, preloadHtmlToMarkdown, shouldConvertHtml } from "@/utils/html-to-markdown";

/**
 * Pastes web content as Markdown instead of as the flattened `text/plain` flavor
 * CodeMirror takes by default.
 *
 * The plain text is inserted first and swapped for the converted Markdown once
 * turndown (loaded on demand) resolves: no dead time on paste, and a conversion
 * failure still leaves the pasted text in the document.
 *
 * Requirements: `docs/dev/requirements/editor/html-paste-to-markdown.md`.
 */
export function htmlPaste(): Extension {
  // Set by Mod-Shift-V for exactly one paste. Browsers disagree on what their own
  // "paste and match style" puts on the clipboard, so we don't rely on it.
  let plainPasteArmed = false;

  return [
    keymap.of([
      {
        key: "Mod-Shift-v",
        run: () => {
          plainPasteArmed = true;
          // Not handled: the browser still performs the paste, and the handler
          // below sees the flag.
          return false;
        },
      },
    ]),
    EditorView.domEventHandlers({
      focus: () => {
        preloadHtmlToMarkdown();
        return false;
      },
      paste: (event, view) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        const armed = plainPasteArmed;
        plainPasteArmed = false;
        if (armed) return false;

        // A code editor's HTML flavor is a tree of syntax-highlighting spans.
        if (clipboard.types.includes("vscode-editor-data")) return false;
        // Media pastes are uploaded by EditorContent's own paste handler.
        if (Array.from(clipboard.items).some((item) => item.kind === "file")) return false;

        const html = clipboard.getData("text/html");
        const plain = clipboard.getData("text/plain");
        if (!shouldConvertHtml(html, plain)) return false;

        event.preventDefault();
        const from = view.state.selection.main.from;
        view.dispatch({ ...view.state.replaceSelection(plain), userEvent: "input.paste", scrollIntoView: true });

        htmlToMarkdown(html)
          .then((markdown) => {
            if (!markdown || markdown === plain) return;
            const to = from + plain.length;
            // Bail out if anything moved the pasted text in the meantime (an
            // external doc sync, a fast second paste).
            if (to > view.state.doc.length || view.state.sliceDoc(from, to) !== plain) return;
            view.dispatch({
              changes: { from, to, insert: markdown },
              selection: { anchor: from + markdown.length },
              userEvent: "input.paste",
              scrollIntoView: true,
            });
          })
          .catch(() => {
            // The plain text is already in the document; leaving it there is the
            // fallback, and an error toast here would only be noise.
          });
        return true;
      },
    }),
  ];
}
