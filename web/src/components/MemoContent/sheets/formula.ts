// Functions x-spreadsheet's built-in formula engine understands. Inserting a
// formula that calls anything else makes its renderer throw
// "Cannot read properties of undefined (reading 'render')" and takes down the
// whole grid, so we validate before inserting.
export const SUPPORTED_FUNCTIONS = new Set(["SUM", "AVERAGE", "MAX", "MIN", "PRODUCT", "DIVIDE", "SUBTRACT", "CONCAT", "IF", "AND", "OR", "SUMIF", "COUNTIF", "AVERAGEIF"]);

// Returns the first function name used in `formula` that x-spreadsheet does not
// support, or null if the formula only uses supported functions. A function
// call is any identifier immediately followed by "(".
export function unsupportedFunction(formula: string): string | null {
  const callRe = /([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(formula)) !== null) {
    const name = match[1].toUpperCase();
    if (!SUPPORTED_FUNCTIONS.has(name)) return name;
  }
  return null;
}
