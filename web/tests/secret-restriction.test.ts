import { describe, expect, it } from "vitest";
import { isLocalSecretId, isRestrictedLocalSecretId, newLocalSecretId, parseSecretBlock, serializeSecretBlock } from "@/utils/secret-block";
import {
  EMERGENCY_STATEMENTS,
  emergencyReasonLongEnough,
  emergencyStatementFor,
  normalizeTypedText,
  secretCharClass,
  splitSecretSegments,
  typedTextMatches,
} from "@/utils/secret-restriction";

describe("typed confirmation", () => {
  it("compares like the server: whitespace collapsed, everything else exact", () => {
    expect(normalizeTypedText("  我已想清楚，\n  明早再处理 ")).toBe("我已想清楚， 明早再处理");
    expect(typedTextMatches("I  am sure", "I am sure")).toBe(true);
    expect(typedTextMatches("i am sure", "I am sure")).toBe(false);
    expect(typedTextMatches("I am sure.", "I am sure")).toBe(false);
  });

  it("never matches an empty expected text", () => {
    expect(typedTextMatches("", "   ")).toBe(false);
  });

  it("counts the reason in characters, not bytes", () => {
    expect(emergencyReasonLongEnough("一二三四五六七八九")).toBe(false);
    expect(emergencyReasonLongEnough("一二三四五六七八九十")).toBe(true);
    expect(emergencyReasonLongEnough("   一二三   ")).toBe(false);
  });

  it("picks the emergency statement by UI language", () => {
    expect(emergencyStatementFor("zh-Hans")).toBe(EMERGENCY_STATEMENTS.zh);
    expect(emergencyStatementFor("en")).toBe(EMERGENCY_STATEMENTS.en);
    expect(emergencyStatementFor("de")).toBe(EMERGENCY_STATEMENTS.en);
  });
});

describe("splitSecretSegments", () => {
  it("cuts each line into four-character segments", () => {
    expect(splitSecretSegments("Zx9-admin-PW")).toEqual([["Zx9-", "admi", "n-PW"]]);
    expect(splitSecretSegments("abcdef")).toEqual([["abcd", "ef"]]);
  });

  it("keeps line structure, including empty lines", () => {
    expect(splitSecretSegments("user: me\n\npw: x")).toEqual([["user", ": me"], [], ["pw: ", "x"]]);
  });

  it("never splits a character outside the BMP", () => {
    expect(splitSecretSegments("ab😀cd")).toEqual([["ab😀c", "d"]]);
  });
});

describe("secretCharClass", () => {
  it("labels the characters that are easy to confuse", () => {
    expect(["0", "O", "o", "1", "l", "I", "-", " ", "密"].map(secretCharClass)).toEqual([
      "digit",
      "upper",
      "lower",
      "digit",
      "lower",
      "upper",
      "symbol",
      "space",
      "other",
    ]);
  });
});

describe("restricted placeholder ids", () => {
  it("are local ids that survive a markdown round trip", () => {
    const id = newLocalSecretId({ restricted: true });
    expect(isLocalSecretId(id)).toBe(true);
    expect(isRestrictedLocalSecretId(id)).toBe(true);
    expect(parseSecretBlock(serializeSecretBlock(id))?.id).toBe(id);
    expect(isRestrictedLocalSecretId(newLocalSecretId())).toBe(false);
  });
});
