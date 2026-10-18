import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Leaves dropped files to EditorContent's upload handler.
 *
 * CodeMirror's built-in drop handler reads every dropped file with `readAsText` and
 * inserts whatever doesn't look binary. PNG/JPG fail that check, but an SVG is plain
 * XML, so it landed in the document as source text next to the uploaded image's
 * reference. Claiming file drops here skips that built-in handler (CodeMirror then
 * calls preventDefault for us); the event still bubbles to EditorContent's `onDrop`,
 * which does the upload. Text drags carry no files and keep the default behavior.
 */
export function fileDrop(): Extension {
  return EditorView.domEventHandlers({
    drop: (event) => Boolean(event.dataTransfer?.files.length),
  });
}
