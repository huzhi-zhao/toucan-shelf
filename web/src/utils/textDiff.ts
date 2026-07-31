/**
 * Minimal text diffing used by the AI rewrite review UI.
 *
 * Everything is built on one LCS over arrays: run it on lines to get the
 * side-by-side row model, then again on word tokens to highlight what changed
 * inside a modified line. No dependency — selections are short enough that a
 * quadratic LCS is cheap, and oversized inputs fall back to a whole-block
 * replace instead of allocating a huge matrix.
 */

export type DiffOpType = "equal" | "insert" | "delete";

export interface DiffOp<T> {
  type: DiffOpType;
  items: T[];
}

/** Above this many DP cells we stop diffing and report a wholesale replace. */
const MAX_MATRIX_CELLS = 1_000_000;

function mergeOps<T>(ops: DiffOp<T>[]): DiffOp<T>[] {
  const merged: DiffOp<T>[] = [];
  for (const op of ops) {
    if (op.items.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.items.push(...op.items);
    else merged.push({ type: op.type, items: [...op.items] });
  }
  return merged;
}

function diffCore<T>(a: T[], b: T[]): DiffOp<T>[] {
  if (a.length === 0 || b.length === 0) {
    return [
      { type: "delete" as const, items: a },
      { type: "insert" as const, items: b },
    ].filter((op) => op.items.length > 0);
  }
  if (a.length * b.length > MAX_MATRIX_CELLS) {
    return [
      { type: "delete", items: a },
      { type: "insert", items: b },
    ];
  }

  // dp[i * width + j] = length of the LCS of a[i:] and b[j:].
  const width = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const ops: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", items: [a[i]] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: "delete", items: [a[i]] });
      i++;
    } else {
      ops.push({ type: "insert", items: [b[j]] });
      j++;
    }
  }
  if (i < a.length) ops.push({ type: "delete", items: a.slice(i) });
  if (j < b.length) ops.push({ type: "insert", items: b.slice(j) });
  return mergeOps(ops);
}

/** Diff two sequences into equal/delete/insert runs (deletes precede inserts). */
export function diffSequences<T>(a: T[], b: T[]): DiffOp<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return mergeOps([
    { type: "equal", items: a.slice(0, start) },
    ...diffCore(a.slice(start, endA), b.slice(start, endB)),
    { type: "equal", items: a.slice(endA) },
  ]);
}

/**
 * Split text into diff tokens: each CJK character stands alone (there are no
 * spaces to split on), latin/number runs stay whole, whitespace and other
 * characters are their own tokens.
 */
export function tokenizeWords(text: string): string[] {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_'’-]+|\s+|./gsu) ?? [];
}

export interface InlinePart {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  /** `equal` rows carry both sides; `modified` pairs a removed and an added line. */
  type: "equal" | "modified" | "added" | "removed";
  /** Index of the change block this row belongs to, or null for unchanged rows. */
  hunk: number | null;
  /** Original line and its 1-based number, null on a purely added row. */
  left: string | null;
  leftNumber: number | null;
  /** Rewritten line and its 1-based number, null on a purely removed row. */
  right: string | null;
  rightNumber: number | null;
  /** Word-level breakdown, only on `modified` rows. */
  leftParts?: InlinePart[];
  rightParts?: InlinePart[];
}

/** Below this word-level similarity a modified pair is highlighted as a whole. */
const INTRA_LINE_SIMILARITY_FLOOR = 0.3;

function inlineParts(before: string, after: string): { left: InlinePart[]; right: InlinePart[] } | null {
  const ops = diffSequences(tokenizeWords(before), tokenizeWords(after));
  const common = ops.filter((op) => op.type === "equal").reduce((sum, op) => sum + op.items.join("").length, 0);
  const total = before.length + after.length;
  if (total === 0 || (common * 2) / total < INTRA_LINE_SIMILARITY_FLOOR) return null;

  const left: InlinePart[] = [];
  const right: InlinePart[] = [];
  for (const op of ops) {
    const text = op.items.join("");
    if (op.type !== "insert") left.push({ text, changed: op.type === "delete" });
    if (op.type !== "delete") right.push({ text, changed: op.type === "insert" });
  }
  return { left, right };
}

/**
 * Build the aligned row model shown in the review dialog. Consecutive changed
 * lines share a `hunk` id so they can be accepted or rejected as one block.
 */
export function buildDiffRows(original: string, revised: string): DiffRow[] {
  const ops = diffSequences(original.split("\n"), revised.split("\n"));
  const rows: DiffRow[] = [];
  let leftNumber = 0;
  let rightNumber = 0;
  let hunk = 0;

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    if (op.type === "equal") {
      for (const line of op.items) {
        rows.push({ type: "equal", hunk: null, left: line, leftNumber: ++leftNumber, right: line, rightNumber: ++rightNumber });
      }
      continue;
    }
    // A change block is a delete run, an insert run, or a delete immediately
    // followed by an insert — the three shapes diffSequences can produce.
    const removed = op.type === "delete" ? op.items : [];
    const next = ops[index + 1];
    const added = op.type === "insert" ? op.items : next?.type === "insert" ? next.items : [];
    if (op.type === "delete" && next?.type === "insert") index++;

    const id = hunk++;
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      const parts = inlineParts(removed[k], added[k]);
      rows.push({
        type: "modified",
        hunk: id,
        left: removed[k],
        leftNumber: ++leftNumber,
        right: added[k],
        rightNumber: ++rightNumber,
        leftParts: parts?.left,
        rightParts: parts?.right,
      });
    }
    for (const line of removed.slice(paired)) {
      rows.push({ type: "removed", hunk: id, left: line, leftNumber: ++leftNumber, right: null, rightNumber: null });
    }
    for (const line of added.slice(paired)) {
      rows.push({ type: "added", hunk: id, left: null, leftNumber: null, right: line, rightNumber: ++rightNumber });
    }
  }
  return rows;
}

/** Number of distinct change blocks in a row model. */
export function countHunks(rows: DiffRow[]): number {
  return new Set(rows.filter((row) => row.hunk !== null).map((row) => row.hunk)).size;
}

/** Rebuild the text, taking the rewritten side only for the accepted hunks. */
export function applyHunks(rows: DiffRow[], accepted: ReadonlySet<number>): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.hunk === null) {
      if (row.left !== null) lines.push(row.left);
      continue;
    }
    const side = accepted.has(row.hunk) ? row.right : row.left;
    if (side !== null) lines.push(side);
  }
  return lines.join("\n");
}
