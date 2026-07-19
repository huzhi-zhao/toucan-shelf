// x-data-spreadsheet's formula engine looks up functions in a shared `formulam`
// object and calls `formulam[name].render(...)`. If a cell contains a function
// the engine doesn't know (SUMPRODUCT, VLOOKUP, COUNT, …) the lookup is
// undefined and `.render` throws "Cannot read properties of undefined
// (reading 'render')" — during a canvas draw, which takes down the whole page.
//
// We can't intercept the property access, but `formulam` is a shared, mutable
// object imported by reference in the library's renderer, so registering
// fallback entries makes unknown functions compute to a marker (or a best-effort
// value) instead of crashing. The cell's raw formula text is left untouched, so
// this is lossless on write-back.

// @ts-expect-error - deep import; this subpath ships no type declarations.
import { formulam } from "x-data-spreadsheet/src/core/formula";
// @ts-expect-error - deep import; this subpath ships no type declarations.
import cellModule from "x-data-spreadsheet/src/core/cell";
import { cellRef, columnIndex } from "./cellRef";

type FormulaEntry = { key: string; title: () => string; render: (ary: unknown[]) => unknown };
const registry = formulam as Record<string, FormulaEntry>;

const toNum = (v: unknown): number => Number(v);
const nums = (ary: unknown[]): number[] => ary.map(toNum).filter((n) => !Number.isNaN(n));

// Best-effort implementations for common functions that operate on the flat
// argument list the engine passes. Anything not listed here (and not built in)
// falls back to the "#N/A" stub below.
const implementations: Record<string, (ary: unknown[]) => unknown> = {
  // x-spreadsheet ships PRODUCT/DIVIDE/SUBTRACT commented out (see
  // core/formula.js), yet the backend prompt and SUPPORTED_FUNCTIONS allow them,
  // so without these entries a "=PRODUCT(...)" the model returns crashes the
  // renderer. Register the implementations the library intended.
  PRODUCT: (ary) => nums(ary).reduce((a, b) => a * b, 1),
  DIVIDE: (ary) => nums(ary).reduce((a, b) => a / b),
  SUBTRACT: (ary) => nums(ary).reduce((a, b) => a - b),
  COUNT: (ary) => nums(ary).length,
  COUNTA: (ary) => ary.filter((v) => String(v ?? "").trim() !== "").length,
  ABS: (ary) => Math.abs(toNum(ary[0])),
  INT: (ary) => Math.floor(toNum(ary[0])),
  SQRT: (ary) => Math.sqrt(toNum(ary[0])),
  ROUND: (ary) => Math.round(toNum(ary[0])),
  ROUNDUP: (ary) => Math.ceil(toNum(ary[0])),
  ROUNDDOWN: (ary) => Math.floor(toNum(ary[0])),
  LEN: (ary) => String(ary[0] ?? "").length,

  // Argument lists here are produced by rewriteCriteriaFormulas, not by the
  // library's own range handling — see the comment on CRITERIA_FNS.
  COUNTIF: (ary) => criteriaArgs(ary).count,
  SUMIF: (ary) => nums(criteriaArgs(ary).matched).reduce((a, b) => a + b, 0),
  AVERAGEIF: (ary) => {
    const values = nums(criteriaArgs(ary).matched);
    return values.length === 0 ? "#DIV/0!" : values.reduce((a, b) => a + b, 0) / values.length;
  },
};

// --- Criteria functions (SUMIF / COUNTIF / AVERAGEIF) ---------------------
//
// The library's parser cannot handle "a range followed by another argument":
// `infixExprToSuffixExpr` sets fnArgType=2 on ":" (which expands the range into
// individual cells) but the following "," overwrites it with 1, so
// `AVERAGEIF(A2:A12,">1000")` reaches the engine as just ["A2","A12",criteria].
// We therefore rewrite the formula text before the engine parses it, expanding
// ranges ourselves and appending the criteria-range length so `render` can tell
// the two ranges apart:
//
//   AVERAGEIF(A2:A12,">1000")      -> AVERAGEIF(A2,A3,…,A12,">1000",11)
//   SUMIF(A2:A4,">10",B2:B4)       -> SUMIF(A2,A3,A4,B2,B3,B4,">10",3)
const CRITERIA_FNS = new Set(["SUMIF", "COUNTIF", "AVERAGEIF"]);
const RANGE_RE = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/;
const MAX_EXPAND = 5000; // guard against a typo'd range producing a huge string

// Splits "A1:A9,\">10\",SUM(B1,B2)" on top-level commas only.
function splitArgs(src: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuote) {
      if (c === '"') inQuote = false;
    } else if (c === '"') inQuote = true;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  args.push(src.slice(start));
  return args;
}

// Expands "A2:B3" into ["A2","A3","B2","B3"]; returns null if not a range.
function expandRange(arg: string): string[] | null {
  const m = RANGE_RE.exec(arg.trim());
  if (!m) return null;
  const [, sc, sr, ec, er] = m;
  const [x1, x2] = [columnIndex(sc), columnIndex(ec)].sort((a, b) => a - b);
  const [y1, y2] = [Number(sr) - 1, Number(er) - 1].sort((a, b) => a - b);
  if ((x2 - x1 + 1) * (y2 - y1 + 1) > MAX_EXPAND) return null;
  const cells: string[] = [];
  for (let x = x1; x <= x2; x += 1) {
    for (let y = y1; y <= y2; y += 1) cells.push(cellRef(y, x));
  }
  return cells;
}

// Rewrites every SUMIF/COUNTIF/AVERAGEIF call in `src` (innermost calls too).
export function rewriteCriteriaFormulas(src: string): string {
  const nameRe = /([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(src)) !== null) {
    const name = match[1].toUpperCase();
    if (!CRITERIA_FNS.has(name)) continue;

    // Find the matching close paren for this call.
    let depth = 1;
    let inQuote = false;
    let end = -1;
    for (let i = nameRe.lastIndex; i < src.length; i += 1) {
      const c = src[i];
      if (inQuote) {
        if (c === '"') inQuote = false;
      } else if (c === '"') inQuote = true;
      else if (c === "(") depth += 1;
      else if (c === ")" && (depth -= 1) === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break; // unbalanced; leave the rest alone

    const args = splitArgs(src.slice(nameRe.lastIndex, end));
    const critCells = args[0] !== undefined ? expandRange(args[0]) : null;
    if (!critCells || args.length < 2) continue; // not a shape we can rewrite
    const valueCells = args.length > 2 ? expandRange(args[2]) : null;
    const rewritten = `${name}(${[...critCells, ...(valueCells ?? []), args[1].trim(), String(critCells.length)].join(",")})`;
    src = src.slice(0, match.index) + rewritten + src.slice(end + 1);
    nameRe.lastIndex = match.index + rewritten.length;
  }
  return src;
}

// Matches a cell value against an Excel-style criteria such as ">1000", "<=5",
// "<>x" or a bare value (equality). Wildcards * and ? apply to text equality.
function matchesCriteria(value: unknown, criteria: string): boolean {
  const trimmed = criteria.trim();
  const opMatch = /^(<=|>=|<>|<|>|=)/.exec(trimmed);
  const op = opMatch ? opMatch[1] : "=";
  const operand = opMatch ? trimmed.slice(op.length).trim() : trimmed;

  const left = Number(value);
  const right = Number(operand);
  const numeric = operand !== "" && !Number.isNaN(right) && !Number.isNaN(left) && String(value ?? "").trim() !== "";
  if (numeric) {
    switch (op) {
      case ">":
        return left > right;
      case ">=":
        return left >= right;
      case "<":
        return left < right;
      case "<=":
        return left <= right;
      case "<>":
        return left !== right;
      default:
        return left === right;
    }
  }

  const text = String(value ?? "").toLowerCase();
  const target = operand.toLowerCase();
  if (op === "=" || op === "<>") {
    const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    const equal = pattern.test(text);
    return op === "=" ? equal : !equal;
  }
  switch (op) {
    case ">":
      return text > target;
    case ">=":
      return text >= target;
    case "<":
      return text < target;
    default:
      return text <= target;
  }
}

// Unpacks the argument list produced by rewriteCriteriaFormulas.
function criteriaArgs(ary: unknown[]): { matched: unknown[]; count: number } {
  const critLen = Number(ary[ary.length - 1]);
  const criteria = String(ary[ary.length - 2] ?? "");
  const cells = ary.slice(0, -2);
  const critCells = cells.slice(0, critLen);
  const valueCells = cells.length > critLen ? cells.slice(critLen) : critCells;
  const matched: unknown[] = [];
  critCells.forEach((cell, i) => {
    if (matchesCriteria(cell, criteria)) matched.push(valueCells[i]);
  });
  return { matched, count: matched.length };
}

// Common function names that we don't compute but must not crash on.
const stubbed = [
  "SUMPRODUCT",
  "VLOOKUP",
  "HLOOKUP",
  "XLOOKUP",
  "LOOKUP",
  "INDEX",
  "MATCH",
  "COUNTIFS",
  "SUMIFS",
  "AVERAGEIFS",
  "IFERROR",
  "IFS",
  "POWER",
  "MOD",
  "MEDIAN",
  "MODE",
  "STDEV",
  "VAR",
  "RANK",
  "LARGE",
  "SMALL",
  "TEXT",
  "VALUE",
  "LEFT",
  "RIGHT",
  "MID",
  "TRIM",
  "UPPER",
  "LOWER",
  "CONCATENATE",
  "REPLACE",
  "SUBSTITUTE",
  "FIND",
  "SEARCH",
  "NOW",
  "TODAY",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "WEEKDAY",
];

let patched = false;

// Registers fallback formula entries. Idempotent; safe to call on every mount.
// Never overrides a function the library already implements.
export function ensureFormulaFallbacks(): void {
  if (patched) return;
  patched = true;

  const register = (key: string, render: (ary: unknown[]) => unknown) => {
    if (registry[key]) return; // keep any built-in implementation
    registry[key] = { key, title: () => key, render };
  };

  for (const [key, render] of Object.entries(implementations)) {
    register(key, render);
  }
  for (const key of stubbed) {
    register(key, () => "#N/A");
  }

  // Expand SUMIF/COUNTIF/AVERAGEIF ranges before the engine's parser sees them.
  const originalRender = cellModule.render;
  cellModule.render = (src: string, ...rest: unknown[]) =>
    originalRender(typeof src === "string" && src[0] === "=" ? rewriteCriteriaFormulas(src) : src, ...rest);
}
