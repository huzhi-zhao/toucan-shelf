import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { type EmbedTarget, makeEmbedCompletionSource } from "@/components/MemoEditor/Editor/embedAutocomplete";

const docs: EmbedTarget[] = [
  { path: "/api.md", title: "API Reference" },
  { path: "/folder/design-notes.md", title: "Design Notes" },
  { path: "/api-changelog.md", title: "API Changelog" },
];

function complete(doc: string, pos: number, documents: EmbedTarget[] = docs) {
  const source = makeEmbedCompletionSource(() => documents);
  const state = EditorState.create({ doc });
  return source(new CompletionContext(state, pos, false));
}

describe("embed autocomplete", () => {
  it("offers every document right after `![[` with nothing typed yet", () => {
    const result = complete("hello ![[", 9);
    expect(result?.options.map((o) => o.label).sort()).toEqual(["API Changelog", "API Reference", "Design Notes"]);
  });

  it("filters by title as the user types", () => {
    const result = complete("hello ![[api r", 14);
    expect(result?.options.map((o) => o.label)).toEqual(["API Reference"]);
  });

  it("matches on path as well as title", () => {
    const result = complete("hello ![[design-notes", 21);
    expect(result?.options.map((o) => o.label)).toEqual(["Design Notes"]);
  });

  it("applies the doc's path plus the closing brackets", () => {
    const result = complete("![[api r", 8);
    const option = result?.options.find((o) => o.label === "API Reference");
    expect(option?.apply).toBe("/api.md]]");
  });

  it("replaces from right after `![[`, not from the start of the line", () => {
    const result = complete("note: ![[api", 12);
    expect(result?.from).toBe("note: ![[".length);
  });

  it("returns null once the embed is already closed", () => {
    const doc = "![[api.md]] more text";
    expect(complete(doc, doc.length)).toBeNull();
  });

  it("returns null when not inside an embed", () => {
    expect(complete("hello world", 11)).toBeNull();
  });

  it("returns null when there are no matching documents", () => {
    expect(complete("![[nonexistent", 14)).toBeNull();
  });
});
