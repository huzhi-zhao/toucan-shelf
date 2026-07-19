import { describe, expect, it } from "vitest";
// @ts-expect-error - deep import; this subpath ships no type declarations.
import cellModule from "x-data-spreadsheet/src/core/cell";
// @ts-expect-error - deep import; this subpath ships no type declarations.
import { formulam } from "x-data-spreadsheet/src/core/formula";
import { ensureFormulaFallbacks, rewriteCriteriaFormulas } from "@/components/MemoContent/sheets/formulaPatch";

ensureFormulaFallbacks();

// A: 500, 1500, 2000, 800   B: 1, 2, 3, 4   (rows 2..5)
const grid: Record<string, string> = {
  A2: "500",
  A3: "1500",
  A4: "2000",
  A5: "800",
  B2: "1",
  B3: "2",
  B4: "3",
  B5: "4",
};
const getCellText = (x: number, y: number) => grid[`${String.fromCharCode(65 + x)}${y + 1}`] ?? "";
const evaluate = (formula: string) => cellModule.render(formula, formulam, getCellText);

describe("criteria formula rewrite", () => {
  it("expands the criteria range and appends its length", () => {
    expect(rewriteCriteriaFormulas('=AVERAGEIF(A2:A5,">1000")')).toBe('=AVERAGEIF(A2,A3,A4,A5,">1000",4)');
    expect(rewriteCriteriaFormulas('=SUMIF(A2:A3,">1",B2:B3)')).toBe('=SUMIF(A2,A3,B2,B3,">1",2)');
  });

  it("leaves other functions alone", () => {
    expect(rewriteCriteriaFormulas("=SUM(A2:A5)")).toBe("=SUM(A2:A5)");
  });
});

describe("SUMIF / COUNTIF / AVERAGEIF", () => {
  it("averages only the matching cells", () => {
    expect(evaluate('=AVERAGEIF(A2:A5,">1000")')).toBe(1750);
  });

  it("counts matching cells", () => {
    expect(evaluate('=COUNTIF(A2:A5,">1000")')).toBe(2);
    expect(evaluate("=COUNTIF(A2:A5,500)")).toBe(1);
  });

  it("sums the criteria range by default", () => {
    expect(evaluate('=SUMIF(A2:A5,"<=800")')).toBe(1300);
  });

  it("sums a separate value range when given", () => {
    expect(evaluate('=SUMIF(A2:A5,">1000",B2:B5)')).toBe(5);
  });

  it("returns #DIV/0! when nothing matches", () => {
    expect(evaluate('=AVERAGEIF(A2:A5,">99999")')).toBe("#DIV/0!");
  });

  it("composes with arithmetic", () => {
    expect(evaluate('=AVERAGEIF(A2:A5,">1000")/2')).toBe(875);
  });
});
