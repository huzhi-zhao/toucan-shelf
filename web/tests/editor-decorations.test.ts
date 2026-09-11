import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { mentionDecorations } from "@/components/MemoEditor/Editor/mentionDecorations";

function countClass(doc: string, cls: string): number {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [mentionDecorations] }), parent: document.body });
  const n = view.dom.querySelectorAll(`.${cls}`).length;
  view.destroy();
  return n;
}

describe("mention decorations", () => {
  it("decorates @mentions", () => expect(countClass("hi @alice", "cm-memo-mention")).toBe(1));
  it("leaves a #hash undecorated", () => expect(countClass("a #todo and #work/sub b", "cm-memo-mention")).toBe(0));
});
