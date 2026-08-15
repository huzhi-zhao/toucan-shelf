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
