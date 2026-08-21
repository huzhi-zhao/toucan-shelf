import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { htmlPaste } from "@/components/MemoEditor/Editor/htmlPaste";

// CodeMirror's built-in paste handler calls preventDefault whether or not this extension
// took over, so the assertions look at the document instead: converted pastes end up as
// Markdown, skipped ones keep the plain-text flavor.

interface ClipboardFlavors {
  html?: string;
  plain?: string;
  types?: string[];
  hasFile?: boolean;
}

function paste(view: EditorView, { html = "", plain = "", types, hasFile = false }: ClipboardFlavors): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: types ?? [...(plain ? ["text/plain"] : []), ...(html ? ["text/html"] : [])],
      items: hasFile ? [{ kind: "file" }] : [],
      getData: (type: string) => (type === "text/html" ? html : plain),
    },
  });
  view.contentDOM.dispatchEvent(event);
}

function mount(doc = ""): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions: [htmlPaste()] }), parent: document.body });
}

/** Long enough for the on-demand turndown import and the follow-up dispatch to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("html paste", () => {
  it("inserts the plain text first, then swaps in the converted markdown", async () => {
    const view = mount();
    paste(view, { html: "<h2>Title</h2><p>with <strong>bold</strong></p>", plain: "Title\nwith bold" });

    expect(view.state.doc.toString()).toBe("Title\nwith bold");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("## Title\n\nwith **bold**"));
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    view.destroy();
  });

  it("leaves an already-markdown clipboard alone", async () => {
    const view = mount();
    const plain = "## Setup\n\n- a\n- b";
    paste(view, { html: "<h2>Setup</h2><ul><li>a</li><li>b</li></ul>", plain });

    await settle();
    expect(view.state.doc.toString()).toBe(plain);
    view.destroy();
  });

  it("leaves media pastes to the upload handler", async () => {
    const view = mount();
    paste(view, { html: '<img src="https://cdn.example.com/a.png">', plain: "", hasFile: true });

    await settle();
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("leaves a code editor clipboard alone", async () => {
    const view = mount();
    paste(view, {
      html: '<pre><code><span style="color:#c586c0">const</span> x = 1</code></pre>',
      plain: "const x = 1",
      types: ["text/plain", "text/html", "vscode-editor-data"],
    });

    await settle();
    expect(view.state.doc.toString()).toBe("const x = 1");
    view.destroy();
  });

  it("pastes plain text for one paste after Mod-Shift-V", async () => {
    const view = mount();
    const flavors = { html: "<h2>Title</h2>", plain: "Title" };

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "V", code: "KeyV", keyCode: 86, shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    paste(view, flavors);
    await settle();
    expect(view.state.doc.toString()).toBe("Title");
    view.destroy();

    // The flag is one-shot: the next paste converts again.
    const next = mount();
    paste(next, flavors);
    await vi.waitFor(() => expect(next.state.doc.toString()).toBe("## Title"));
    next.destroy();
  });
});
