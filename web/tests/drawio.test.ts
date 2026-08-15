import { describe, expect, it } from "vitest";
import { extractDrawioXml, isDrawioSvg, isSvgUrl } from "@/utils/drawio";

// Trimmed-down but structurally faithful draw.io export: the `content` attribute holds the
// whole mxfile, HTML-escaped, on the root <svg>.
const drawioSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="-0.5 -0.5 120 60"
  content="&lt;mxfile host=&quot;app.diagrams.net&quot;&gt;&lt;diagram name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;">
  <rect x="0" y="0" width="120" height="60" fill="#ffffff" stroke="#000000"/>
</svg>`;

const plainSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>`;

describe("extractDrawioXml", () => {
  it("returns the unescaped mxfile source of a draw.io export", () => {
    const xml = extractDrawioXml(drawioSvg);
    expect(xml).not.toBeNull();
    expect(xml?.startsWith("<mxfile")).toBe(true);
    expect(xml).toContain(`host="app.diagrams.net"`);
    expect(xml).toContain("<mxGraphModel>");
    expect(xml?.endsWith("</mxfile>")).toBe(true);
  });

  it("returns null for a plain SVG", () => {
    expect(extractDrawioXml(plainSvg)).toBeNull();
  });

  it("returns null when content exists but is not an mxfile", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="just an mxfile mention"><rect/></svg>`;
    expect(extractDrawioXml(svg)).toBeNull();
  });

  it("does not sniff heuristically — mxCell markup alone is not enough", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><desc>&lt;mxfile&gt;&lt;mxCell/&gt;&lt;/mxfile&gt;</desc></svg>`;
    expect(extractDrawioXml(svg)).toBeNull();
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(extractDrawioXml(`<svg content="&lt;mxfile"><rect>`)).toBeNull();
    expect(extractDrawioXml("")).toBeNull();
    expect(extractDrawioXml("not xml at all, mxfile")).toBeNull();
  });

  it("ignores a content attribute on a non-root element", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g content="&lt;mxfile&gt;&lt;/mxfile&gt;"/></svg>`;
    expect(extractDrawioXml(svg)).toBeNull();
  });
});

describe("isDrawioSvg", () => {
  it("distinguishes draw.io exports from ordinary SVGs", () => {
    expect(isDrawioSvg(drawioSvg)).toBe(true);
    expect(isDrawioSvg(plainSvg)).toBe(false);
  });
});

describe("isSvgUrl", () => {
  it("matches .svg paths regardless of query or hash", () => {
    expect(isSvgUrl("/file/attachments/abc/login-seq.svg")).toBe(true);
    expect(isSvgUrl("/file/attachments/abc/login-seq.SVG?v=2")).toBe(true);
    expect(isSvgUrl("/file/attachments/abc/photo.png")).toBe(false);
    expect(isSvgUrl(undefined)).toBe(false);
  });
});
