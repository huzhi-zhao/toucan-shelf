import { describe, expect, it } from "vitest";
import { parseSheetsBlock } from "@/components/MemoContent/sheets/parseSheetsBlock";
import { parseFenceId } from "@/components/MemoContent/sheets/serializeSheetsBlock";
import { applySheetsStyle, extractSheetsStyle, parseStyleOverlay, serializeStyleOverlay } from "@/components/MemoContent/sheets/sheetStyle";
import { toSpreadsheetData, type XSheet } from "@/components/MemoContent/sheets/toSpreadsheetData";

// Reproduces exactly what SheetsBlock does on a cold page load, minus React:
// fence -> blockId, blockId -> overlay JSON, CSV + overlay -> loadData payload.
function loadOnRefresh(fenceLine: string, body: string, nodeOverlays: Record<string, string>): XSheet[] {
  const blockId = parseFenceId(fenceLine.replace(/^```sheets[ \t]*/, ""));
  const data = parseSheetsBlock(body);
  const effectiveId = blockId ?? data.view.id;
  const overlayJson = effectiveId ? nodeOverlays[effectiveId] : undefined;
  const xsheets = toSpreadsheetData(data);
  applySheetsStyle(xsheets, parseStyleOverlay(overlayJson));
  return xsheets;
}

// A styled grid as x-spreadsheet's getData() would report it: a styles table plus
// a per-cell index into it.
const STYLED: XSheet[] = [
  {
    name: "S",
    styles: [{ bold: true, bgcolor: "#fde68a" }],
    rows: { 0: { cells: { 0: { text: "a", style: 0 }, 1: { text: "b" } } } },
  } as XSheet,
];

describe("style overlay survives a page refresh", () => {
  it("restores cell styles from a fence id + node_overlays", () => {
    const overlay = extractSheetsStyle(STYLED);
    expect(overlay).toBeDefined();
    const json = serializeStyleOverlay(overlay!);

    const xsheets = loadOnRefresh("```sheets id=abc123", "sheet:S\na,b", { abc123: json });

    expect(xsheets[0].styles).toEqual([{ bold: true, bgcolor: "#fde68a" }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((xsheets[0].rows as any)[0].cells[0].style).toBe(0);
    // Cell text still comes from the CSV, untouched by the overlay.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((xsheets[0].rows as any)[0].cells[0].text).toBe("a");
  });

  it("still restores styles for a legacy in-body id (no fence id)", () => {
    const json = serializeStyleOverlay(extractSheetsStyle(STYLED)!);
    const xsheets = loadOnRefresh("```sheets", "sheet:S\na,b\n\nview:\n  id: legacy1", { legacy1: json });
    expect(xsheets[0].styles).toEqual([{ bold: true, bgcolor: "#fde68a" }]);
  });

  it("renders unstyled when the overlay key does not match the fence id", () => {
    const json = serializeStyleOverlay(extractSheetsStyle(STYLED)!);
    const xsheets = loadOnRefresh("```sheets id=abc123", "sheet:S\na,b", { somethingElse: json });
    expect(xsheets[0].styles).toBeUndefined();
  });
});
