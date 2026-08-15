/**
 * draw.io stores the full `.drawio` source (an `<mxfile>` document, HTML-escaped) in a
 * non-standard `content` attribute on the root `<svg>` element when exporting with
 * "Include a copy of my diagram" (the default). That makes one file both the rendered
 * image and its own editable source — see ADR-0017.
 *
 * The detection here is deliberately structural, never heuristic: root element is `<svg>`,
 * it carries `content`, and that content starts with `<mxfile`. A false positive would hang
 * an edit button on a plain SVG and let a save overwrite it with something else, so missing
 * an occasional diagram is by far the cheaper failure.
 */

/** Origin of the draw.io embed editor. Single constant so a self-hosted `jgraph/drawio` is a one-line swap. */
export const DRAWIO_EMBED_ORIGIN = "https://embed.diagrams.net";

/**
 * Returns the embedded `mxfile` XML of a draw.io-exported SVG, or null for any SVG that
 * isn't one (including malformed input — callers treat null as "just a picture").
 */
export const extractDrawioXml = (svgText: string): string | null => {
  if (!svgText.includes("mxfile")) {
    // Cheap reject before paying for a full XML parse; every non-draw.io SVG exits here.
    return null;
  }

  let root: Element | null = null;
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      return null;
    }
    root = doc.documentElement;
  } catch {
    return null;
  }

  if (!root || root.tagName.toLowerCase() !== "svg") {
    return null;
  }

  // getAttribute already un-escapes the entities draw.io wrote (&lt; &quot; …).
  const content = root.getAttribute("content")?.trim();
  if (!content || !content.startsWith("<mxfile")) {
    return null;
  }
  return content;
};

export const isDrawioSvg = (svgText: string): boolean => extractDrawioXml(svgText) !== null;

/**
 * Elements whose character data is part of the rendering — whitespace inside them is
 * significant (`xml:space` aside, a stray newline in a `<text>` shows up as a space).
 */
const TEXT_PRESERVING_TAGS = new Set(["text", "tspan", "textpath", "style", "title", "desc", "foreignobject"]);

const hasTextPreservingAncestor = (node: Node): boolean => {
  for (let parent = node.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
    if (TEXT_PRESERVING_TAGS.has((parent as Element).tagName.toLowerCase())) return true;
  }
  return false;
};

/**
 * draw.io emits every text label twice: a `<switch>` holds a `<foreignObject>` with the real
 * HTML text and, next to it, a base64 PNG raster of that same text as a fallback for renderers
 * without foreignObject support. The rasters dominate the file — on a typical ER diagram they
 * are ~90% of the bytes, dwarfing even the embedded `<mxfile>` source.
 *
 * Dropping them keeps the diagram identical in any browser (which all take the foreignObject
 * branch) and makes the text real, selectable text. The cost is renderers that ignore
 * foreignObject — Inkscape, ImageMagick, some SVG→PDF converters — which lose the labels.
 */
const stripRasterTextFallbacks = (doc: Document) => {
  for (const node of Array.from(doc.getElementsByTagName("switch"))) {
    if (node.getElementsByTagName("foreignObject").length === 0) continue;
    for (const image of Array.from(node.getElementsByTagName("image"))) {
      // Only the generated fallbacks, never a picture the user actually placed: those live
      // outside a `<switch>`, and the fallback is always an inline data URI.
      const href = image.getAttribute("xlink:href") || image.getAttribute("href") || "";
      if (href.startsWith("data:image/")) image.parentNode?.removeChild(image);
    }
  }
};

const stripDeadWeight = (doc: Document) => {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT);
  const doomed: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.COMMENT_NODE) {
      doomed.push(node);
    } else if (!(node.nodeValue || "").trim() && !hasTextPreservingAncestor(node)) {
      doomed.push(node);
    }
  }
  for (const node of doomed) node.parentNode?.removeChild(node);
};

/** Parses an SVG document, returning null for anything that isn't well-formed SVG. */
const parseSvgDocument = (svgText: string): Document | null => {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    if (doc.documentElement?.tagName.toLowerCase() !== "svg") return null;
    return doc;
  } catch {
    return null;
  }
};

/**
 * The stored form of a draw.io SVG: raster text fallbacks, comments and layout whitespace
 * removed, but the `content` attribute — the actual editing source — left alone. Roughly an
 * 88% saving on a text-heavy diagram, with editing, preview and "Download XML" all intact.
 * Applied on upload and before every save, since draw.io re-adds the rasters on each export.
 *
 * Returns null when the input isn't a draw.io SVG, so callers can store the file untouched
 * rather than round-tripping an unrelated image through a serializer.
 */
export const compactDrawioSvg = (svgText: string): string | null => {
  if (!svgText.includes("mxfile")) return null;
  const doc = parseSvgDocument(svgText);
  if (!doc) return null;
  if (!doc.documentElement.getAttribute("content")?.trim().startsWith("<mxfile")) return null;

  stripRasterTextFallbacks(doc);
  stripDeadWeight(doc);
  return new XMLSerializer().serializeToString(doc);
};

/**
 * Strips everything that only the editor or a non-browser renderer needs, leaving a plain
 * picture: the raster text fallbacks (see above), the embedded `<mxfile>` source (the
 * `content` attribute), XML comments, and whitespace-only text nodes outside text-bearing
 * elements.
 *
 * The result renders identically in a browser but can no longer be re-opened in draw.io, so it
 * is only ever used for the "download as image" path — the attachment URL still serves the
 * original. Returns the input unchanged if it can't be parsed; a failed optimisation must not
 * cost the user their download.
 */
export const optimizeDrawioSvg = (svgText: string): string => {
  const doc = parseSvgDocument(svgText);
  if (!doc) return svgText;

  doc.documentElement.removeAttribute("content");
  stripRasterTextFallbacks(doc);
  stripDeadWeight(doc);

  return new XMLSerializer().serializeToString(doc);
};

/**
 * `compactDrawioSvg` for raw upload bytes: returns the compacted encoding for a draw.io SVG and
 * the input itself for anything else, so non-diagram uploads are stored byte-for-byte. Every
 * path that creates or replaces an attachment runs through this.
 */
export const compactDrawioSvgBytes = (bytes: Uint8Array, mimeType?: string, filename?: string): Uint8Array => {
  if (mimeType !== "image/svg+xml" && !isSvgUrl(filename)) return bytes;
  try {
    const compacted = compactDrawioSvg(new TextDecoder().decode(bytes));
    return compacted === null ? bytes : new TextEncoder().encode(compacted);
  } catch {
    return bytes;
  }
};

/** True for URLs that could carry a draw.io diagram at all — avoids fetching every image just to probe it. */
export const isSvgUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  const path = url.split(/[?#]/)[0];
  return path.toLowerCase().endsWith(".svg");
};

/**
 * Fetches an SVG and extracts its diagram source. Returns null on any failure — the probe runs
 * after the `<img>` has already loaded (so this request hits the http cache) and must never be
 * able to affect whether the image renders.
 */
export const probeDrawioXml = async (url: string, signal?: AbortSignal): Promise<string | null> => {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    return extractDrawioXml(await response.text());
  } catch {
    return null;
  }
};
