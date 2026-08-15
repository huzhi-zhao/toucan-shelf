import { describe, expect, it } from "vitest";
import { compactDrawioSvg, compactDrawioSvgBytes, extractDrawioXml, optimizeDrawioSvg } from "@/utils/drawio";

const drawioSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" content="&lt;mxfile host=&quot;app.diagrams.net&quot;&gt;&lt;diagram&gt;PAYLOAD&lt;/diagram&gt;&lt;/mxfile&gt;">
  <!-- exported by draw.io -->
  <g>
    <rect x="0" y="0" width="10" height="10"/>
    <text x="2" y="8">hello  world</text>
  </g>
</svg>`;

// draw.io's label markup: real HTML text plus a base64 PNG raster of the same text as a
// fallback for renderers without foreignObject support.
const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50">
  <image x="0" y="0" width="20" height="20" xlink:href="data:image/png;base64,REALPICTURE"/>
  <switch>
    <foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">table_name</div></foreignObject>
    <image x="1" y="2" width="30" height="8" xlink:href="data:image/png;base64,RASTERFALLBACK"/>
  </switch>
</svg>`;

describe("optimizeDrawioSvg", () => {
  it("drops the raster text fallback but keeps the real text", () => {
    const optimized = optimizeDrawioSvg(labelSvg);
    expect(optimized).not.toContain("RASTERFALLBACK");
    expect(optimized).toContain("table_name");
    expect(optimized).toContain("<foreignObject");
  });

  it("keeps images the user actually placed, outside any switch", () => {
    expect(optimizeDrawioSvg(labelSvg)).toContain("REALPICTURE");
  });

  it("drops the embedded mxfile source so the file is no longer re-importable", () => {
    const optimized = optimizeDrawioSvg(drawioSvg);
    expect(optimized).not.toContain("mxfile");
    expect(extractDrawioXml(optimized)).toBeNull();
  });

  it("keeps the drawing intact and shrinks the file", () => {
    const optimized = optimizeDrawioSvg(drawioSvg);
    expect(optimized).toContain("<rect");
    expect(optimized).toContain("hello  world");
    expect(optimized).toContain('width="100"');
    expect(optimized.length).toBeLessThan(drawioSvg.length);
  });

  it("removes comments and layout whitespace but not text content", () => {
    const optimized = optimizeDrawioSvg(drawioSvg);
    expect(optimized).not.toContain("exported by draw.io");
    expect(optimized).not.toContain("\n  <g>");
  });

  it("returns unparseable input untouched rather than losing the download", () => {
    expect(optimizeDrawioSvg("<svg><g></svg>")).toBe("<svg><g></svg>");
    expect(optimizeDrawioSvg("not xml at all")).toBe("not xml at all");
  });
});

// A draw.io export as it really arrives: embedded mxfile source plus a rastered label.
const drawioWithLabel = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50" content="&lt;mxfile&gt;&lt;diagram&gt;PAYLOAD&lt;/diagram&gt;&lt;/mxfile&gt;">
  <!-- exported by draw.io -->
  <switch>
    <foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">table_name</div></foreignObject>
    <image xlink:href="data:image/png;base64,RASTERFALLBACK"/>
  </switch>
</svg>`;

describe("compactDrawioSvg", () => {
  it("drops the rasters but keeps the diagram re-importable into draw.io", () => {
    const compacted = compactDrawioSvg(drawioWithLabel);
    expect(compacted).not.toBeNull();
    expect(compacted).not.toContain("RASTERFALLBACK");
    // The whole point: editing still works after storage.
    expect(extractDrawioXml(compacted as string)).toContain("<mxfile");
    expect(compacted).toContain("table_name");
    expect((compacted as string).length).toBeLessThan(drawioWithLabel.length);
  });

  it("is idempotent — draw.io re-adds rasters on every export, so save runs it again", () => {
    const once = compactDrawioSvg(drawioWithLabel) as string;
    expect(compactDrawioSvg(once)).toBe(once);
  });

  it("returns null for SVGs that are not draw.io exports, so they upload untouched", () => {
    expect(compactDrawioSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
    expect(compactDrawioSvg("not xml at all")).toBeNull();
  });
});

describe("compactDrawioSvgBytes", () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  it("compacts a draw.io upload identified by mime type or by filename", () => {
    const raw = encode(drawioWithLabel);
    for (const bytes of [compactDrawioSvgBytes(raw, "image/svg+xml"), compactDrawioSvgBytes(raw, "", "diagram.svg")]) {
      expect(bytes.byteLength).toBeLessThan(raw.byteLength);
      expect(new TextDecoder().decode(bytes)).not.toContain("RASTERFALLBACK");
    }
  });

  it("passes non-SVG and non-draw.io uploads through byte-for-byte", () => {
    const png = encode("\x89PNG not really");
    expect(compactDrawioSvgBytes(png, "image/png", "a.png")).toBe(png);
    const plain = encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(compactDrawioSvgBytes(plain, "image/svg+xml", "a.svg")).toBe(plain);
  });
});
