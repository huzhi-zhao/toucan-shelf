import { describe, expect, it } from "vitest";
import {
  isSubDocFolderPath,
  isSubDocument,
  resolveSubDocHref,
  SUB_DOC_FOLDER_PREFIX,
  splitChildMemos,
  subDocFolderPath,
  subDocHref,
} from "@/utils/subDoc";

// A sub-document and a comment are both child memos and both arrive from the
// same listMemoComments call; the folder path is the only thing that tells them
// apart. These tests pin that reading, because every surface that shows one has
// to exclude the other.
describe("sub-document folder paths", () => {
  it("builds the reserved path from a parent memo name", () => {
    expect(subDocFolderPath("memos/abc123")).toBe(`${SUB_DOC_FOLDER_PREFIX}/abc123`);
  });

  it("recognizes the exact one-level shape", () => {
    expect(isSubDocFolderPath("_sub/abc123")).toBe(true);
  });

  it("rejects shapes the server would not create", () => {
    // A bare prefix names no parent.
    expect(isSubDocFolderPath("_sub")).toBe(false);
    expect(isSubDocFolderPath("_sub/")).toBe(false);
    // Sub-documents are one level deep, like the relation underneath them.
    expect(isSubDocFolderPath("_sub/abc123/deeper")).toBe(false);
    // A folder that merely starts with the same letters is an ordinary folder.
    expect(isSubDocFolderPath("_subscriptions")).toBe(false);
  });

  it("treats a comment's empty folder path as not a sub-document", () => {
    expect(isSubDocFolderPath("")).toBe(false);
    expect(isSubDocFolderPath(undefined)).toBe(false);
  });

  it("does not mistake an ordinary document's folder for the reserved one", () => {
    expect(isSubDocFolderPath("notes/2026")).toBe(false);
  });
});

describe("splitChildMemos", () => {
  const children = [
    { folderPath: "", name: "memos/c1" },
    { folderPath: "_sub/parent1", name: "memos/s1" },
    { folderPath: "", name: "memos/c2" },
    { folderPath: "_sub/parent1", name: "memos/s2" },
  ];

  it("separates comments from sub-documents", () => {
    const { comments, subDocs } = splitChildMemos(children);
    expect(comments.map((c) => c.name)).toEqual(["memos/c1", "memos/c2"]);
    expect(subDocs.map((s) => s.name)).toEqual(["memos/s1", "memos/s2"]);
  });

  it("partitions every child into exactly one bucket", () => {
    const { comments, subDocs } = splitChildMemos(children);
    expect(comments.length + subDocs.length).toBe(children.length);
    expect(comments.every((c) => !isSubDocument(c))).toBe(true);
    expect(subDocs.every((s) => isSubDocument(s))).toBe(true);
  });
});

describe("sub-document references in the body", () => {
  const parent = "memos/parent1";
  const subDocs = [
    { name: "memos/s1", title: "补充说明" },
    { name: "memos/s2", title: "Appendix B" },
  ];

  it("writes a reference as a workspace path, not a fragment", () => {
    // Paths are covered by the rename/move repair; a "#fragment" would be
    // classified external, never rewritten, and would go dead on first rename.
    expect(subDocHref(parent, "Appendix B")).toBe("/_sub/parent1/Appendix%20B.md");
  });

  it("round-trips a reference it wrote", () => {
    const href = subDocHref(parent, "补充说明");
    expect(resolveSubDocHref(href, parent, subDocs)?.name).toBe("memos/s1");
  });

  it("accepts a reference written without the extension", () => {
    expect(resolveSubDocHref("/_sub/parent1/Appendix B", parent, subDocs)?.name).toBe("memos/s2");
  });

  it("matches titles case-insensitively, like the workspace resolver", () => {
    expect(resolveSubDocHref("/_sub/parent1/appendix b.md", parent, subDocs)?.name).toBe("memos/s2");
  });

  it("ignores a query string or fragment on the href", () => {
    expect(resolveSubDocHref("/_sub/parent1/Appendix B.md#section", parent, subDocs)?.name).toBe("memos/s2");
  });

  it("does not resolve another document's sub-document", () => {
    // A sub-document belongs to exactly one document; a path naming someone
    // else's must not resolve here.
    expect(resolveSubDocHref("/_sub/other/补充说明.md", parent, subDocs)).toBeUndefined();
  });

  it("does not resolve a title this document has no sub-document for", () => {
    expect(resolveSubDocHref("/_sub/parent1/Nothing.md", parent, subDocs)).toBeUndefined();
  });

  it("leaves ordinary document links alone", () => {
    expect(resolveSubDocHref("/notes/plan.md", parent, subDocs)).toBeUndefined();
    expect(resolveSubDocHref("#heading", parent, subDocs)).toBeUndefined();
    expect(resolveSubDocHref("https://example.com", parent, subDocs)).toBeUndefined();
    expect(resolveSubDocHref(undefined, parent, subDocs)).toBeUndefined();
  });
});
