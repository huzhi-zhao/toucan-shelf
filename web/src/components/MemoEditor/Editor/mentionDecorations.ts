import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { MENTION_RUN } from "@/utils/mention-grammar";
import { viewportDecorations } from "./viewportDecorations";

const MENTION_RE = new RegExp(`(^|[^A-Za-z0-9])@(${MENTION_RUN})`, "gu");
const mentionMark = Decoration.mark({ class: "cm-memo-mention" });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(text)) !== null) {
      const start = from + m.index + m[1].length; // skip the boundary char
      builder.add(start, start + 1 + m[2].length, mentionMark);
    }
  }
  return builder.finish();
}

export const mentionDecorations = viewportDecorations(build);
