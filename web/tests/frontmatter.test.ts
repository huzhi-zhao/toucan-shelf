import { describe, expect, it } from "vitest";
import { hasFrontmatter, parseFrontmatter, selectOptionsFor, setFrontmatterProperty } from "@/utils/frontmatter";

describe("parseFrontmatter", () => {
  it("returns the original content untouched when there is no frontmatter", () => {
    const content = "# Title\n\nSome body text.";
    const result = parseFrontmatter(content);
    expect(result.properties).toEqual([]);
    expect(result.body).toBe(content);
  });

  it("does not treat a non-leading `---` block as frontmatter", () => {
    const content = "intro\n\n---\ntitle: x\n---\n";
    const result = parseFrontmatter(content);
    expect(result.properties).toEqual([]);
    expect(result.body).toBe(content);
  });

  it("classifies each scalar type and strips the block from the body", () => {
    const content = [
      "---",
      "title: AI Ethics Week 1",
      "count: 42",
      "ratio: 3.14",
      "done: true",
      "pending: false",
      "date: 2026-07-11",
      "at: 2026-07-11T10:30:00",
      "empty:",
      "---",
      "# Body",
    ].join("\n");

    const { properties, body } = parseFrontmatter(content);
    expect(body).toBe("# Body");
    expect(properties).toEqual([
      { key: "title", type: "text", value: "AI Ethics Week 1" },
      { key: "count", type: "number", value: 42 },
      { key: "ratio", type: "number", value: 3.14 },
      { key: "done", type: "checkbox", value: true },
      { key: "pending", type: "checkbox", value: false },
      { key: "date", type: "date", value: "2026-07-11" },
      { key: "at", type: "datetime", value: "2026-07-11T10:30:00" },
      { key: "empty", type: "text", value: null },
    ]);
  });

  it("parses both flow and block lists", () => {
    const content = ["---", "tags: [ai, ethics]", "authors:", "  - Alice", "  - Bob", "---", "body"].join("\n");
    const { properties } = parseFrontmatter(content);
    expect(properties).toEqual([
      { key: "tags", type: "list", value: ["ai", "ethics"] },
      { key: "authors", type: "list", value: ["Alice", "Bob"] },
    ]);
  });

  it("keeps quoted values as text even when they look like other types", () => {
    const content = ['---', 'a: "2026-07-11"', "b: 'true'", 'c: "42"', "---", "body"].join("\n");
    const { properties } = parseFrontmatter(content);
    expect(properties).toEqual([
      { key: "a", type: "text", value: "2026-07-11" },
      { key: "b", type: "text", value: "true" },
      { key: "c", type: "text", value: "42" },
    ]);
  });

  it("ignores non-compliant nested maps but keeps sibling compliant fields", () => {
    const content = ["---", "title: Hello", "meta:", "  author: Alice", "  year: 2026", "status: done", "---", "body"].join("\n");
    const { properties } = parseFrontmatter(content);
    expect(properties).toEqual([
      { key: "title", type: "text", value: "Hello" },
      { key: "status", type: "select", value: "done" },
    ]);
  });

  it("dedupes repeated keys, keeping the first occurrence", () => {
    const content = ["---", "title: First", "title: Second", "---", "body"].join("\n");
    const { properties } = parseFrontmatter(content);
    expect(properties).toEqual([{ key: "title", type: "text", value: "First" }]);
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\ntitle: Hi\r\n---\r\n# Body";
    const { properties, body } = parseFrontmatter(content);
    expect(properties).toEqual([{ key: "title", type: "text", value: "Hi" }]);
    expect(body).toBe("# Body");
  });

  it("strips an empty frontmatter block and renders no properties", () => {
    const content = "---\n---\nbody";
    const { properties, body } = parseFrontmatter(content);
    expect(properties).toEqual([]);
    expect(body).toBe("body");
  });
});

describe("hasFrontmatter", () => {
  it("detects a leading frontmatter block", () => {
    expect(hasFrontmatter("---\ntitle: x\n---\nbody")).toBe(true);
    expect(hasFrontmatter("# no frontmatter")).toBe(false);
    expect(hasFrontmatter("text\n---\ntitle: x\n---")).toBe(false);
  });
});

describe("built-in single-select properties", () => {
  it("classifies reserved keys holding a built-in option as select", () => {
    const content = ["---", "status: in-process", "priority: p1", "---", "body"].join("\n");
    expect(parseFrontmatter(content).properties).toEqual([
      { key: "status", type: "select", value: "in-process" },
      { key: "priority", type: "select", value: "p1" },
    ]);
  });

  it("treats an off-list value on a reserved key as plain text", () => {
    const content = ["---", "status: shipped", "priority: urgent", "---", "body"].join("\n");
    expect(parseFrontmatter(content).properties).toEqual([
      { key: "status", type: "text", value: "shipped" },
      { key: "priority", type: "text", value: "urgent" },
    ]);
  });

  it("keeps an unset reserved key as an empty select", () => {
    const content = ["---", "status:", "note:", "---", "body"].join("\n");
    expect(parseFrontmatter(content).properties).toEqual([
      { key: "status", type: "select", value: null },
      { key: "note", type: "text", value: null },
    ]);
  });

  it("does not give the built-in options to other keys", () => {
    const content = ["---", "state: done", "---", "body"].join("\n");
    expect(parseFrontmatter(content).properties).toEqual([{ key: "state", type: "text", value: "done" }]);
  });

  it("exposes the option list only for reserved keys", () => {
    expect(selectOptionsFor("status")).toEqual(["created", "in-process", "done"]);
    expect(selectOptionsFor("priority")).toEqual(["p0", "p1", "p2", "p3"]);
    expect(selectOptionsFor("title")).toBeUndefined();
    expect(selectOptionsFor("toString")).toBeUndefined();
  });
});

describe("setFrontmatterProperty", () => {
  const doc = ["---", "title: Topics", "status: created", "tags: [ai]", "hidden: false", "---", "# Body", "", "text"].join("\n");

  it("rewrites only the targeted line", () => {
    expect(setFrontmatterProperty(doc, "status", "done")).toBe(
      ["---", "title: Topics", "status: done", "tags: [ai]", "hidden: false", "---", "# Body", "", "text"].join("\n"),
    );
  });

  it("writes each value kind back in its YAML form", () => {
    expect(parseFrontmatter(setFrontmatterProperty(doc, "hidden", true)).properties).toContainEqual({
      key: "hidden",
      type: "checkbox",
      value: true,
    });
    expect(parseFrontmatter(setFrontmatterProperty(doc, "tags", ["ai", "ethics"])).properties).toContainEqual({
      key: "tags",
      type: "list",
      value: ["ai", "ethics"],
    });
    expect(setFrontmatterProperty(doc, "tags", [])).toContain("tags: []");
  });

  it("empties a value into a bare key", () => {
    expect(setFrontmatterProperty(doc, "status", null)).toContain("status:\n");
    expect(parseFrontmatter(setFrontmatterProperty(doc, "status", null)).properties).toContainEqual({
      key: "status",
      type: "select",
      value: null,
    });
  });

  it("quotes text that would otherwise round-trip as another type", () => {
    for (const value of ["42", "true", "2026-07-11", "a: b", " padded", "- dash"]) {
      const updated = setFrontmatterProperty(doc, "title", value);
      expect(parseFrontmatter(updated).properties).toContainEqual({ key: "title", type: "text", value });
    }
  });

  it("leaves a URL unquoted and readable", () => {
    const updated = setFrontmatterProperty(doc, "title", "https://example.com/a.png");
    expect(updated).toContain("title: https://example.com/a.png");
    expect(parseFrontmatter(updated).properties).toContainEqual({ key: "title", type: "text", value: "https://example.com/a.png" });
  });

  it("replaces a block list with the inline form, dropping its old items", () => {
    const blockDoc = ["---", "tags:", "  - ai", "  - ethics", "title: Topics", "---", "body"].join("\n");
    expect(setFrontmatterProperty(blockDoc, "tags", ["ai"])).toBe(["---", "tags: [ai]", "title: Topics", "---", "body"].join("\n"));
  });

  it("appends a key the document doesn't declare yet", () => {
    expect(setFrontmatterProperty("---\ntitle: Topics\n---\nbody", "priority", "p2")).toBe(
      ["---", "title: Topics", "priority: p2", "---", "body"].join("\n"),
    );
  });

  it("leaves content without frontmatter untouched", () => {
    expect(setFrontmatterProperty("# Body", "status", "done")).toBe("# Body");
  });
});
