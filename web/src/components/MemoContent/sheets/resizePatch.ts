// Column-width / row-height drags don't reach our commit path on their own.
//
// Every other edit x-spreadsheet makes goes through DataProxy.changeData(),
// which fires the `change` event we debounce into a write. The two resizers are
// the exception: `rowResizerFinished` / `colResizerFinished` in component/sheet.js
// call `data.rows.setHeight(...)` / `data.cols.setWidth(...)` directly and then
// just re-render, so the new size lives in getData() but nothing ever tells us
// to persist it — the sizes survive until the next reload and then vanish.
//
// The library exposes no event for this, so we wrap the resizers' `finishedFn`
// callbacks (the hooks Sheet itself installs) and notify after the original ran.
// The sizes themselves need no extra plumbing: they're already part of the
// XSheet `cols`/`rows` data that extractSheetsStyle() writes to the overlay.

import type Spreadsheet from "x-data-spreadsheet";

type FinishedFn = (cRect: unknown, distance: number) => void;
interface Resizer {
  finishedFn?: FinishedFn;
  __memosPatched?: boolean;
}

// Marks the wrapped callbacks so a re-run (e.g. a remount reusing an instance)
// can't stack wrappers and fire the notification twice per drag.
function patchResizer(resizer: Resizer | undefined, onResize: () => void): void {
  if (!resizer || resizer.__memosPatched) return;
  const original = resizer.finishedFn;
  resizer.finishedFn = (cRect, distance) => {
    original?.(cRect, distance);
    onResize();
  };
  resizer.__memosPatched = true;
}

// Calls `onResize` after the user finishes dragging a column or row divider.
export function observeResizes(instance: Spreadsheet, onResize: () => void): void {
  const sheet = (instance as unknown as { sheet?: { rowResizer?: Resizer; colResizer?: Resizer } }).sheet;
  if (!sheet) return;
  patchResizer(sheet.rowResizer, onResize);
  patchResizer(sheet.colResizer, onResize);
}
