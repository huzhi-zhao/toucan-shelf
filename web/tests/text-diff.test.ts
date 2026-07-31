import { describe, expect, it } from "vitest";
import { applyHunks, buildDiffRows, countHunks, diffSequences, tokenizeWords } from "@/utils/textDiff";

const acceptAll = (rows: ReturnType<typeof buildDiffRows>) => new Set(rows.flatMap((row) => (row.hunk === null ? [] : [row.hunk])));

describe("diffSequences", () => {
  it("reports identical input as a single equal run", () => {
    expect(diffSequences(["a", "b"], ["a", "b"])).toEqual([{ type: "equal", items: ["a", "b"] }]);
  });

  it("finds the changed middle", () => {
    expect(diffSequences(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      { type: "equal", items: ["a"] },
      { type: "delete", items: ["b"] },
      { type: "insert", items: ["x"] },
      { type: "equal", items: ["c"] },
    ]);
  });
});

describe("tokenizeWords", () => {
  it("keeps latin words whole and splits CJK per character", () => {
    expect(tokenizeWords("hello 世界")).toEqual(["hello", " ", "世", "界"]);
  });

  it("round-trips the input", () => {
    const text = "The quick brown fox，跳过了懒狗。\n";
    expect(tokenizeWords(text).join("")).toBe(text);
  });
});

describe("buildDiffRows", () => {
  it("pairs a changed line and marks the changed words", () => {
    const rows = buildDiffRows("keep\nold line\n", "keep\nnew line\n");
    expect(rows.map((row) => row.type)).toEqual(["equal", "modified", "equal"]);
    expect(rows[1].leftParts?.filter((part) => part.changed).map((part) => part.text)).toEqual(["old"]);
    expect(rows[1].rightParts?.filter((part) => part.changed).map((part) => part.text)).toEqual(["new"]);
  });

  it("groups consecutive changed lines into one hunk and separated ones into two", () => {
    expect(countHunks(buildDiffRows("a\nb\nc", "a\nB\nC"))).toBe(1);
    expect(countHunks(buildDiffRows("a\nb\nc", "A\nb\nC"))).toBe(2);
  });

  it("gives no hunks for identical text", () => {
    expect(countHunks(buildDiffRows("same", "same"))).toBe(0);
  });
});

describe("applyHunks", () => {
  it("reproduces the rewrite when every hunk is accepted", () => {
    const original = "intro\nold one\ntail\nold two";
    const revised = "intro\nnew one\ntail\nnew two";
    const rows = buildDiffRows(original, revised);
    expect(applyHunks(rows, acceptAll(rows))).toBe(revised);
  });

  it("reproduces the original when no hunk is accepted", () => {
    const original = "intro\nold one\ntail\nold two";
    const rows = buildDiffRows(original, "intro\nnew one\ntail\nnew two");
    expect(applyHunks(rows, new Set())).toBe(original);
  });

  it("mixes accepted and rejected hunks", () => {
    const rows = buildDiffRows("a\nb\nc", "A\nb\nC");
    expect(applyHunks(rows, new Set([0]))).toBe("A\nb\nc");
    expect(applyHunks(rows, new Set([1]))).toBe("a\nb\nC");
  });

  it("handles added and removed lines", () => {
    const rows = buildDiffRows("one\ntwo", "one\ntwo\nthree");
    expect(applyHunks(rows, acceptAll(rows))).toBe("one\ntwo\nthree");
    expect(applyHunks(rows, new Set())).toBe("one\ntwo");
  });
});
