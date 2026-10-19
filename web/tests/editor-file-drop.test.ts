import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { fileDrop } from "@/components/MemoEditor/Editor/fileDrop";

// jsdom has no DataTransfer, so the drop event carries a minimal stand-in with just the
// fields CodeMirror's drop handler reads.

const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

function drop(view: EditorView, { files = [], text = "" }: { files?: File[]; text?: string }): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: [...(files.length ? ["Files"] : []), ...(text ? ["text/plain"] : [])],
      getData: (type: string) => (type === "Text" || type === "text/plain" ? text : ""),
    },
  });
  Object.defineProperty(event, "clientX", { value: 0 });
  Object.defineProperty(event, "clientY", { value: 0 });
  view.contentDOM.dispatchEvent(event);
  return event;
}

function mount(extensions: Extension[], doc = ""): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions }), parent: document.body });
}

/** Long enough for CodeMirror's FileReader-based file drop to finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const svgFile = () => new File([SVG_SOURCE], "diagram.svg", { type: "image/svg+xml" });

describe("editor file drop", () => {
  it("reproduces the bug without the extension: CodeMirror inserts the SVG's XML", async () => {
    const view = mount([]);
    drop(view, { files: [svgFile()] });

    await vi.waitFor(() => expect(view.state.doc.toString()).toBe(SVG_SOURCE));
    view.destroy();
  });

  it("does not insert a dropped SVG's source text", async () => {
    const view = mount([fileDrop()], "before");
    const event = drop(view, { files: [svgFile()] });

    await settle();
    expect(view.state.doc.toString()).toBe("before");
    expect(event.defaultPrevented).toBe(true);
    view.destroy();
  });

  it("does not insert the contents of any dropped file", async () => {
    const view = mount([fileDrop()]);
    drop(view, { files: [new File(["# notes"], "notes.md", { type: "text/markdown" }), svgFile()] });

    await settle();
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("still lets the drop bubble to the host's upload handler", () => {
    const view = mount([fileDrop()]);
    const onHostDrop = vi.fn();
    document.body.addEventListener("drop", onHostDrop);
    const file = svgFile();
    drop(view, { files: [file] });

    expect(onHostDrop).toHaveBeenCalledTimes(1);
    expect((onHostDrop.mock.calls[0][0] as DragEvent).dataTransfer?.files).toEqual([file]);
    document.body.removeEventListener("drop", onHostDrop);
    view.destroy();
  });

  it("keeps the default behavior for plain text drags", () => {
    const view = mount([fileDrop()]);
    drop(view, { text: "dragged text" });

    expect(view.state.doc.toString()).toBe("dragged text");
    view.destroy();
  });
});
