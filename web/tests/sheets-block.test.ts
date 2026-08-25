import { describe, expect, it } from "vitest";
import { unsupportedFunction } from "@/components/MemoContent/sheets/formula";
import { parseSheetsBlock } from "@/components/MemoContent/sheets/parseSheetsBlock";
import { parseFenceId, serializeSheets, writeSheetsBlock } from "@/components/MemoContent/sheets/serializeSheetsBlock";
import { applySheetsStyle, extractSheetsStyle, parseStyleOverlay, serializeStyleOverlay } from "@/components/MemoContent/sheets/sheetStyle";
import { fromSpreadsheetData, toSpreadsheetData } from "@/components/MemoContent/sheets/toSpreadsheetData";

describe("parseSheetsBlock", () => {
  it("parses multiple named sheets of CSV", () => {
    const raw = ["sheet:销售数据", "name,price,qty", "苹果,3.5,10", "香蕉,2.1,20", "", "sheet:统计汇总", "month,total", "1月,1000"].join(
      "\n",
    );

    const data = parseSheetsBlock(raw);

    expect(data.sheets).toEqual([
      {
        name: "销售数据",
        rows: [
          ["name", "price", "qty"],
          ["苹果", "3.5", "10"],
          ["香蕉", "2.1", "20"],
        ],
      },
      {
        name: "统计汇总",
        rows: [
          ["month", "total"],
          ["1月", "1000"],
        ],
      },
    ]);
    expect(data.view.lock).toBe(false);
  });

  it("reads a leading lock config line (backward compat)", () => {
    const data = parseSheetsBlock(["lock: true", "", "sheet:S", "a,b"].join("\n"));
    expect(data.view.lock).toBe(true);
    expect(data.sheets).toHaveLength(1);
  });

  it("parses a trailing view: block without treating it as sheet data", () => {
    const raw = ["sheet:S", "a,b", "1,2", "", "view:", "  lock: true", "  height: 1230"].join("\n");
    const data = parseSheetsBlock(raw);
    expect(data.sheets).toHaveLength(1);
    expect(data.sheets[0].rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(data.view).toEqual({ lock: true });
  });

  it("ignores legacy in-body height lines (height now lives in node_overlays)", () => {
    const data = parseSheetsBlock(["sheet:S", "a", "view:", "  height: 800", "  hight: 800"].join("\n"));
    expect(data.sheets[0].rows).toEqual([["a"]]);
    expect(data.view).toEqual({ lock: false });
  });

  it("treats a marker-less block as a single sheet", () => {
    const data = parseSheetsBlock(["a,b", "1,2"].join("\n"));
    expect(data.sheets).toEqual([
      {
        name: "Sheet1",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
  });

  it("preserves formula strings and quoted fields with commas", () => {
    const raw = ["sheet:S", '"a,b",=SUM(A1:A2)', "1,2"].join("\n");
    const data = parseSheetsBlock(raw);
    expect(data.sheets[0].rows[0]).toEqual(["a,b", "=SUM(A1:A2)"]);
  });
});

describe("serialize round-trip", () => {
  it("round-trips parse → serialize", () => {
    const raw = ["sheet:销售数据", "name,price", "苹果,3.5", "", "sheet:汇总", "month,total", "1月,1000"].join("\n");
    const serialized = serializeSheets(parseSheetsBlock(raw));
    expect(parseSheetsBlock(serialized)).toEqual(parseSheetsBlock(raw));
  });

  it("round-trips a view block (lock) and drops any legacy height", () => {
    const raw = ["sheet:S", "a,b", "1,2", "", "view:", "  lock: true", "  height: 1230"].join("\n");
    const serialized = serializeSheets(parseSheetsBlock(raw));
    expect(serialized).toContain("view:");
    expect(serialized).toContain("  lock: true");
    expect(serialized).not.toContain("height");
    expect(parseSheetsBlock(serialized)).toEqual(parseSheetsBlock(raw));
  });

  it("keeps the formula string, not a computed value", () => {
    const raw = ["sheet:S", "a", "=SUM(A1:A1)"].join("\n");
    expect(serializeSheets(parseSheetsBlock(raw))).toContain("=SUM(A1:A1)");
  });

  it("drops trailing empty rows/cols added by the grid", () => {
    const data = {
      sheets: [
        {
          name: "S",
          rows: [
            ["a", "b", ""],
            ["1", "", ""],
            ["", "", ""],
          ],
        },
      ],
      view: { lock: false },
    };
    expect(serializeSheets(data)).toBe(["sheet:S", "a,b", "1,"].join("\n"));
  });
});

describe("writeSheetsBlock", () => {
  it("replaces only the fenced block body within surrounding markdown", () => {
    const content = ["# Title", "", "```sheets", "sheet:S", "a,b", "```", "", "after"].join("\n");
    const data = parseSheetsBlock("sheet:S\na,b\n1,2");
    const result = writeSheetsBlock(content, data);
    expect(result).toBe(["# Title", "", "```sheets", "sheet:S", "a,b", "1,2", "```", "", "after"].join("\n"));
  });

  it("returns content unchanged when there is no sheets fence", () => {
    const content = "# just text";
    expect(writeSheetsBlock(content, parseSheetsBlock("sheet:S\na"))).toBe(content);
  });
});

describe("unsupportedFunction", () => {
  it("accepts supported functions and plain arithmetic", () => {
    expect(unsupportedFunction("=B2*C2+B3*C3")).toBeNull();
    expect(unsupportedFunction("=SUM(B2:B3)")).toBeNull();
    expect(unsupportedFunction("=IF(A1>0, AVERAGE(B1:B3), 0)")).toBeNull();
  });

  it("flags the first unsupported function", () => {
    expect(unsupportedFunction("=SUMPRODUCT(B2:B3,C2:C3)")).toBe("SUMPRODUCT");
    expect(unsupportedFunction("=VLOOKUP(A1,B:C,2)")).toBe("VLOOKUP");
    expect(unsupportedFunction("=SUM(A1:A2)+COUNT(B1:B2)")).toBe("COUNT");
  });
});

describe("x-spreadsheet mapping", () => {
  it("round-trips through the x-spreadsheet data shape", () => {
    const data = parseSheetsBlock(["sheet:S", "a,b", "1,2"].join("\n"));
    const back = fromSpreadsheetData(toSpreadsheetData(data));
    expect(back).toEqual(data.sheets);
  });
});

describe("block id (node overlay anchor)", () => {
  it("reads the id from a fence info string", () => {
    expect(parseFenceId("id=1zu8fb")).toBe("1zu8fb");
    expect(parseFenceId("foo id=abc123 bar")).toBe("abc123");
    expect(parseFenceId("")).toBeUndefined();
    expect(parseFenceId(undefined)).toBeUndefined();
  });

  it("writes the id onto the fence line, not into the body", () => {
    const content = ["```sheets", "a,b", "1,2", "```"].join("\n");
    const data = parseSheetsBlock("a,b\n1,2");
    data.view.id = "abc123";
    const out = writeSheetsBlock(content, data);
    expect(out.split("\n")[0]).toBe("```sheets id=abc123");
    expect(out).not.toContain("id: abc123"); // never in the body
  });

  it("replaces a stale fence id while preserving other meta tokens", () => {
    const content = ["```sheets foo id=old bar", "a", "```"].join("\n");
    const data = parseSheetsBlock("a");
    data.view.id = "new1";
    const out = writeSheetsBlock(content, data);
    const fence = out.split("\n")[0];
    expect(fence).toContain("id=new1");
    expect(fence).not.toContain("id=old");
    expect(fence).toContain("foo");
    expect(fence).toContain("bar");
  });

  it("emits a bare fence when no id is set", () => {
    const content = ["```sheets", "a,b", "```"].join("\n");
    const out = writeSheetsBlock(content, parseSheetsBlock("a,b"));
    expect(out.split("\n")[0]).toBe("```sheets");
  });

  it("still parses a legacy in-body view id (backward compat)", () => {
    const data = parseSheetsBlock(["sheet:S", "a,b", "1,2", "", "view:", "  id: legacy1"].join("\n"));
    expect(data.view.id).toBe("legacy1");
  });

  it("migrates a legacy body id onto the fence on rewrite", () => {
    // A dev doc written before the id moved to the fence.
    const content = ["```sheets", "sheet:S", "a,b", "", "view:", "  id: legacy1", "```"].join("\n");
    const data = parseSheetsBlock(["sheet:S", "a,b", "", "view:", "  id: legacy1"].join("\n"));
    const out = writeSheetsBlock(content, data);
    expect(out.split("\n")[0]).toBe("```sheets id=legacy1");
    expect(out).not.toMatch(/^\s*id: legacy1/m); // body id line is gone
  });
});

describe("style overlay", () => {
  it("carries the dragged viewport height through the overlay round-trip", () => {
    const overlay = extractSheetsStyle([{ name: "S", rows: {} }] as never, { viewHeight: 720 });
    expect(overlay?.viewHeight).toBe(720);
    expect(parseStyleOverlay(serializeStyleOverlay(overlay!))?.viewHeight).toBe(720);
    // No styles and no view state means no overlay at all.
    expect(extractSheetsStyle([{ name: "S", rows: {} }] as never)).toBeUndefined();
  });

  it("carries the last-open sheet through the overlay round-trip", () => {
    const overlay = extractSheetsStyle([{ name: "S", rows: {} }] as never, { activeSheet: "Q2" });
    expect(overlay?.activeSheet).toBe("Q2");
    expect(parseStyleOverlay(serializeStyleOverlay(overlay!))?.activeSheet).toBe("Q2");
    // The first sheet is the load-time default, so it is left unrecorded.
    expect(extractSheetsStyle([{ name: "S", rows: {} }] as never, { activeSheet: undefined })).toBeUndefined();
    // A malformed/blank name is ignored rather than restored.
    expect(parseStyleOverlay(JSON.stringify({ v: 1, sheets: {}, activeSheet: "" }))?.activeSheet).toBeUndefined();
  });

  it("extracts styles/merges/cols/row-heights/cell-style, and does not touch CSV text", () => {
    // An x-spreadsheet getData() result carrying both text and styling.
    const xsheets = [
      {
        name: "S",
        styles: [{ bold: true, bgcolor: "#fde68a" }],
        merges: ["A1:B1"],
        cols: { "0": { width: 160 } },
        rows: {
          0: { height: 40, cells: { 0: { text: "a", style: 0 }, 1: { text: "b" } } },
          1: { cells: { 0: { text: "1" }, 1: { text: "2" } } },
        },
      },
    ];

    const overlay = extractSheetsStyle(xsheets);
    expect(overlay).toEqual({
      v: 1,
      sheets: {
        S: {
          styles: [{ bold: true, bgcolor: "#fde68a" }],
          merges: ["A1:B1"],
          cols: { "0": { width: 160 } },
          rows: { "0": { height: 40, cells: { "0": 0 } } },
        },
      },
    });

    // The data side still round-trips to plain text only.
    expect(fromSpreadsheetData(xsheets)).toEqual([
      {
        name: "S",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
  });

  it("returns undefined for an unstyled grid", () => {
    const xsheets = toSpreadsheetData(parseSheetsBlock(["sheet:S", "a,b", "1,2"].join("\n")));
    expect(extractSheetsStyle(xsheets)).toBeUndefined();
  });

  it("re-applies a serialized overlay back onto text-only sheets (full round-trip)", () => {
    const data = parseSheetsBlock(["sheet:S", "a,b", "1,2", "", "view:", "  id: x1"].join("\n"));
    const styled = [
      {
        name: "S",
        styles: [{ bold: true }],
        merges: ["A1:B1"],
        cols: { "0": { width: 120 } },
        rows: { 0: { height: 30, cells: { 0: { text: "a", style: 0 } } } },
      },
    ];
    const json = serializeStyleOverlay(extractSheetsStyle(styled)!);

    // Rebuild from CSV (text only) then splice the overlay back in.
    const xsheets = toSpreadsheetData(data);
    applySheetsStyle(xsheets, parseStyleOverlay(json));

    expect(xsheets[0].styles).toEqual([{ bold: true }]);
    expect(xsheets[0].merges).toEqual(["A1:B1"]);
    expect(xsheets[0].cols).toEqual({ "0": { width: 120 } });
    const rows = xsheets[0].rows as Record<number, { height?: number; cells?: Record<number, { text?: string; style?: number }> }>;
    expect(rows[0].height).toBe(30);
    expect(rows[0].cells?.[0]?.style).toBe(0);
    // Text is preserved from the CSV side, not clobbered by the overlay.
    expect(rows[0].cells?.[0]?.text).toBe("a");
  });

  it("tolerates malformed overlay JSON", () => {
    expect(parseStyleOverlay("not json")).toBeUndefined();
    expect(parseStyleOverlay(undefined)).toBeUndefined();
    expect(parseStyleOverlay("{}")).toBeUndefined();
  });
});
