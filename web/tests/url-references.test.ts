import { describe, expect, it } from "vitest";
import { parseFrontmatter, setFrontmatterProperty } from "@/utils/frontmatter";
import {
  normalizeHttpUrl,
  parseUrlReferenceItem,
  parseUrlReferences,
  serializeUrlReferenceItem,
  setUrlReferences,
} from "@/utils/urlReferences";

const doc = (...lines: string[]) => lines.join("\n");

describe("parseUrlReferences", () => {
  it("reads the canonical form: notes as link text, bare URLs without one", () => {
    const content = doc(
      "---",
      "references:",
      '  - "[Open before changing any budget figure](https://docs.google.com/document/d/abc)"',
      '  - "https://example.com/rfc-123"',
      "status: done",
      "---",
      "body",
    );
    expect(parseUrlReferences(content)).toEqual({
      references: [
        { url: "https://docs.google.com/document/d/abc", note: "Open before changing any budget figure" },
        { url: "https://example.com/rfc-123", note: "" },
      ],
      invalidCount: 0,
    });
  });

  it("reads flush-left items, which YAML allows under a key", () => {
    const content = doc("---", "references:", '- "[合同改动前打开](https://a.com/x)"', "- https://b.com", "status: done", "---", "body");
    expect(parseUrlReferences(content)).toEqual({
      references: [
        { url: "https://a.com/x", note: "合同改动前打开" },
        { url: "https://b.com", note: "" },
      ],
      invalidCount: 0,
    });
  });

  it("reads unquoted items", () => {
    const content = doc("---", "references:", "  - [when the schedule moves](https://a.com/plan)", "---", "body");
    expect(parseUrlReferences(content).references).toEqual([{ url: "https://a.com/plan", note: "when the schedule moves" }]);
  });

  it("reads an inline item and an inline flow list", () => {
    expect(parseUrlReferences(doc("---", 'references: "[n](https://a.com)"', "---", "")).references).toEqual([
      { url: "https://a.com", note: "n" },
    ]);
    expect(parseUrlReferences(doc("---", 'references: [https://a.com, "[x, y](https://b.com)"]', "---", "")).references).toEqual([
      { url: "https://a.com", note: "" },
      { url: "https://b.com", note: "x, y" },
    ]);
  });

  it("counts lines it cannot read instead of dropping them silently", () => {
    const content = doc("---", "references:", "  - https://a.com", "    note: x", "  - not a link", "---", "body");
    expect(parseUrlReferences(content)).toEqual({ references: [{ url: "https://a.com", note: "" }], invalidCount: 2 });
  });

  it("returns nothing for documents without the key or without frontmatter", () => {
    expect(parseUrlReferences("# Title")).toEqual({ references: [], invalidCount: 0 });
    expect(parseUrlReferences(doc("---", "status: done", "---", "body"))).toEqual({ references: [], invalidCount: 0 });
  });
});

describe("parseUrlReferenceItem", () => {
  it("accepts only http(s) URLs", () => {
    expect(parseUrlReferenceItem("[x](/folder/Doc)")).toBeNull();
    expect(parseUrlReferenceItem("javascript:alert(1)")).toBeNull();
    expect(parseUrlReferenceItem("[x](mailto:a@b.c)")).toBeNull();
  });

  it("keeps parentheses inside the URL and unescapes the note", () => {
    expect(parseUrlReferenceItem("[a \\[b\\]](https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual({
      url: "https://en.wikipedia.org/wiki/Foo_(bar)",
      note: "a [b]",
    });
    expect(parseUrlReferenceItem("[n](<https://a.com/x y>)")).toEqual({ url: "https://a.com/x y", note: "n" });
  });

  it("round-trips through serializeUrlReferenceItem", () => {
    const reference = { url: "https://a.com/(x)", note: 'brackets [] and \\ and "quotes"' };
    expect(parseUrlReferenceItem(serializeUrlReferenceItem(reference))).toEqual(reference);
  });
});

describe("setUrlReferences", () => {
  it("writes the canonical form and keeps every other frontmatter line", () => {
    const content = doc("---", "# a comment", "status: done", "references:", "- https://old.com", "tags: [x]", "---", "body");
    const next = setUrlReferences(content, [
      { url: "https://docs.google.com/d/1", note: 'Open "before" editing' },
      { url: "https://b.com", note: "" },
    ]);
    expect(next).toBe(
      doc(
        "---",
        "# a comment",
        "status: done",
        "references:",
        '  - "[Open \\"before\\" editing](https://docs.google.com/d/1)"',
        '  - "https://b.com"',
        "tags: [x]",
        "---",
        "body",
      ),
    );
    expect(parseUrlReferences(next).references).toEqual([
      { url: "https://docs.google.com/d/1", note: 'Open "before" editing' },
      { url: "https://b.com", note: "" },
    ]);
  });

  it("appends the key when the document has frontmatter without it", () => {
    expect(setUrlReferences(doc("---", "status: done", "---", "body"), [{ url: "https://a.com", note: "" }])).toBe(
      doc("---", "status: done", "references:", '  - "https://a.com"', "---", "body"),
    );
  });

  it("creates a frontmatter block for the first reference", () => {
    expect(setUrlReferences("# Title\n\nbody", [{ url: "https://a.com", note: "n" }])).toBe(
      doc("---", "references:", '  - "[n](https://a.com)"', "---", "# Title", "", "body"),
    );
  });

  it("removes the key when the list empties, and the block when nothing is left in it", () => {
    expect(setUrlReferences(doc("---", "status: done", "references:", "  - https://a.com", "---", "body"), [])).toBe(
      doc("---", "status: done", "---", "body"),
    );
    expect(setUrlReferences(doc("---", "references:", "  - https://a.com", "---", "# Title"), [])).toBe("# Title");
  });

  it("leaves content alone when there is nothing to remove", () => {
    const content = doc("---", "---", "body");
    expect(setUrlReferences(content, [])).toBe(content);
    expect(setUrlReferences("body", [])).toBe("body");
  });
});

describe("normalizeHttpUrl", () => {
  it("assumes https for a pasted host and rejects other schemes", () => {
    expect(normalizeHttpUrl("docs.google.com/document/d/abc")).toBe("https://docs.google.com/document/d/abc");
    expect(normalizeHttpUrl("  http://a.com/x y ")).toBe("http://a.com/x%20y");
    expect(normalizeHttpUrl("ftp://a.com")).toBeUndefined();
    expect(normalizeHttpUrl("")).toBeUndefined();
  });
});

describe("frontmatter properties next to references", () => {
  it("does not turn a flush-left list item into a property", () => {
    const content = doc("---", "references:", '- "[n](https://a.com)"', "status: done", "---", "body");
    expect(parseFrontmatter(content).properties).toEqual([
      { key: "references", type: "list", value: ["[n](https://a.com)"] },
      { key: "status", type: "select", value: "done" },
    ]);
  });

  it("replaces a flush-left block list as part of the old value", () => {
    const content = doc("---", "authors:", "- Alice", "- Bob", "status: done", "---", "body");
    expect(setFrontmatterProperty(content, "authors", ["Carol"])).toBe(doc("---", "authors: [Carol]", "status: done", "---", "body"));
  });
});
