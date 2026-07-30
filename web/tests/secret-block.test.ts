import { describe, expect, it } from "vitest";
import {
  isLocalSecretId,
  newLocalSecretId,
  parseSecretBlock,
  rewriteSecretBlock,
  SECRET_BLOCK_VERSION,
  secretBlockFence,
  serializeSecretBlock,
} from "@/utils/secret-block";

describe("parseSecretBlock", () => {
  it("parses a well-formed block", () => {
    expect(parseSecretBlock("v: 1\nid: sb_7Kq2vX9m")).toEqual({ version: 1, id: "sb_7Kq2vX9m", hint: "" });
  });

  it("tolerates blank lines and surrounding whitespace", () => {
    expect(parseSecretBlock("\n  v:1  \n\n  id:  abc  \n")).toEqual({ version: 1, id: "abc", hint: "" });
  });

  it("accepts the keys in either order", () => {
    expect(parseSecretBlock("id: abc\nv: 1")).toEqual({ version: 1, id: "abc", hint: "" });
  });

  it.each([
    ["missing id", "v: 1"],
    ["missing version", "id: abc"],
    ["empty body", ""],
    ["unknown version", "v: 2\nid: abc"],
    ["non-numeric version", "v: one\nid: abc"],
    ["version with trailing junk", "v: 1abc\nid: abc"],
    ["line without a separator", "v: 1\nid: abc\ngarbage"],
    ["empty id", "v: 1\nid:"],
    ["id with a space", "v: 1\nid: ab c"],
    ["id with a slash", "v: 1\nid: secretBlocks/abc"],
  ])("rejects %s", (_label, source) => {
    expect(parseSecretBlock(source)).toBeNull();
  });

  // An unrecognized key may belong to a future format in which `id` means something
  // else; honoring the id anyway could unlock the wrong record.
  it("rejects unknown keys rather than ignoring them", () => {
    expect(parseSecretBlock("v: 1\nid: abc\nkdf: pbkdf2-sha256")).toBeNull();
  });

  // The hint is the block's title and the only clue to what a block is for when
  // reading the raw markdown, so it must survive parsing including CJK and colons.
  it("reads the hint, colons and all", () => {
    expect(parseSecretBlock("v: 1\nid: abc\nhint: MinIO 安装过程: 第 2 步")).toEqual({
      version: 1,
      id: "abc",
      hint: "MinIO 安装过程: 第 2 步",
    });
  });
});

describe("serializeSecretBlock", () => {
  it("round-trips through the parser", () => {
    const id = "sb_7Kq2vX9m";
    expect(parseSecretBlock(serializeSecretBlock(id))).toEqual({ version: SECRET_BLOCK_VERSION, id, hint: "" });
    expect(parseSecretBlock(serializeSecretBlock(id, "prod db"))).toEqual({ version: SECRET_BLOCK_VERSION, id, hint: "prod db" });
  });

  // A newline in the hint would silently become a second body line and break the
  // block, so it is flattened rather than escaped.
  it("flattens newlines in the hint", () => {
    expect(parseSecretBlock(serializeSecretBlock("abc", " a\nb "))?.hint).toBe("a b");
  });

  it("omits an empty hint rather than writing a blank line", () => {
    expect(serializeSecretBlock("abc")).toBe("v: 1\nid: abc");
  });

  it("rejects an id that would not survive the round trip", () => {
    expect(() => serializeSecretBlock("has space")).toThrow(/invalid secret block id/);
  });

  it("renders a complete fence", () => {
    expect(secretBlockFence("abc")).toBe("```toucan-secret\nv: 1\nid: abc\n```");
  });
});

describe("local ids", () => {
  it("mints unique, parseable, recognizably-local ids", () => {
    const a = newLocalSecretId();
    const b = newLocalSecretId();
    expect(a).not.toBe(b);
    expect(isLocalSecretId(a)).toBe(true);
    expect(isLocalSecretId("sb_7Kq2vX9m")).toBe(false);
    expect(parseSecretBlock(serializeSecretBlock(a))?.id).toBe(a);
  });
});

describe("rewriteSecretBlock", () => {
  const doc = ["# Notes", "", "```toucan-secret", "v: 1", "id: local-aaaa", "```", "", "tail"].join("\n");

  it("swaps the id and writes the hint of the matching block", () => {
    const next = rewriteSecretBlock(doc, "local-aaaa", { id: "sb_real", hint: "MinIO 安装过程" });
    expect(next).toBe(["# Notes", "", "```toucan-secret", "v: 1", "id: sb_real", "hint: MinIO 安装过程", "```", "", "tail"].join("\n"));
  });

  // Two uninitialized blocks in one document are only distinguishable by their
  // local ids; landing on the wrong one would point a block at someone else's record.
  it("touches only the block carrying the given id", () => {
    const two = ["```toucan-secret", "v: 1", "id: local-aaaa", "```", "", "```toucan-secret", "v: 1", "id: local-bbbb", "```"].join("\n");
    const next = rewriteSecretBlock(two, "local-bbbb", { id: "sb_real", hint: "" });
    expect(next).toContain("id: local-aaaa");
    expect(next).toContain("id: sb_real");
    expect(next).not.toContain("local-bbbb");
  });

  it("ignores an identical id inside an ordinary code block", () => {
    const decoy = ["```", "id: local-aaaa", "```", "", "```toucan-secret", "v: 1", "id: local-aaaa", "```"].join("\n");
    const next = rewriteSecretBlock(decoy, "local-aaaa", { id: "sb_real", hint: "" });
    expect(next?.split("\n").slice(0, 3)).toEqual(["```", "id: local-aaaa", "```"]);
    expect(next).toContain("id: sb_real");
  });

  // Returning null lets the caller refuse to save rather than persist a document
  // whose block still points nowhere.
  it("returns null when no block carries the id", () => {
    expect(rewriteSecretBlock(doc, "local-zzzz", { id: "sb_real", hint: "" })).toBeNull();
  });
});
