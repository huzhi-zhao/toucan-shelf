import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolve"]>;

import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { HEADING_LINE } from "./formatting";
import { viewportDecorations } from "./viewportDecorations";

const lineDecorations = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-md-h${level}` }));

// A `#`-prefixed line that lives inside a fenced/indented code block is source
// text (e.g. a shell or Python comment), not an ATX heading — the markdown
// parser never treats it as one, so neither should the heading styling.
function inCodeBlock(view: EditorView, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolve(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = view.state.doc.line(n);
      const m = HEADING_LINE.exec(line.text);
      if (m && !inCodeBlock(view, line.from)) {
        builder.add(line.from, line.from, lineDecorations[m[1].length - 1]);
      }
    }
  }
  return builder.finish();
}

export const headingDecorations = viewportDecorations(build);
