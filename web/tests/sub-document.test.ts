import { describe, expect, it } from "vitest";
import { isSubDocFolderPath, isSubDocument, splitChildMemos, SUB_DOC_FOLDER_PREFIX, subDocFolderPath } from "@/utils/subDoc";

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
