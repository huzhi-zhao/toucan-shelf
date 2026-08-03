import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * CSS properties an authored `style` attribute may keep. Everything else is dropped.
 *
 * The list is deliberately typographic: it covers the inline formatting that documents
 * imported from other tools (Obsidian/Quartz exports and the like) actually carry, and
 * nothing that can move an element out of the document flow.
 */
const ALLOWED_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-align",
  "text-decoration",
  "text-shadow",
  "text-transform",
  "letter-spacing",
  "line-height",
  "margin",
  "padding",
  "border",
  "border-radius",
  "width",
  "max-width",
  "height",
  "max-height",
  "display",
]);

/**
 * Longhand families accepted wholesale (`margin-top`, `border-left-color`, …). Kept as
 * prefixes so the list doesn't have to enumerate every side/corner permutation.
 */
const ALLOWED_PROPERTY_PREFIXES = ["margin-", "padding-", "border-"];

/**
 * `display` is the one allowed property that can restructure layout, so its values are
 * whitelisted too. `none` is excluded on purpose: a document — including a PUBLIC shared
 * one — must not be able to hide parts of itself from the reader.
 */
const ALLOWED_DISPLAY_VALUES = new Set(["block", "inline", "inline-block", "flex"]);

/**
 * Properties that stay out no matter what. They are what turns a style attribute into a
 * UI-redressing primitive: taking an element out of flow and floating it over the app's
 * own controls (delete, share, authorize) so a click lands somewhere the reader didn't
 * intend. None of them are in ALLOWED_PROPERTIES either — this is a second, explicit
 * barrier so widening the allow-list later can't quietly let one back in.
 */
const DENIED_PROPERTIES = new Set([
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "transform",
  "content",
  "filter",
  "mix-blend-mode",
  "pointer-events",
  "opacity",
]);

/**
 * Value-level rejects, applied regardless of the property name.
 *
 * `url(` is the important one: `background-image: url(https://attacker/…)` fires a request
 * the moment the document is opened, leaking who read what and when. ToucanShelf documents
 * can be shared publicly, so that is a real disclosure channel, not a theoretical one.
 */
const DENIED_VALUE_PATTERNS = [/url\s*\(/i, /expression\s*\(/i, /@import/i, /javascript:/i, /[<>]/];

const isAllowedProperty = (property: string): boolean => {
  if (DENIED_PROPERTIES.has(property)) return false;
  if (ALLOWED_PROPERTIES.has(property)) return true;
  return ALLOWED_PROPERTY_PREFIXES.some((prefix) => property.startsWith(prefix));
};

/**
 * Splits a declaration list on `;`, ignoring separators inside quotes or parentheses so a
 * value like `font-family: "Fira Code; alt"` stays in one piece.
 */
const splitDeclarations = (style: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (const char of style) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")" && depth > 0) depth--;
    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

/**
 * Filters one `style` attribute down to the allowed declarations, returning "" when
 * nothing survives.
 */
export const sanitizeInlineStyle = (style: string): string => {
  // Comments are stripped first: they are never meaningful here, and leaving them in
  // would let a value be assembled around the pattern checks below.
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, "");
  const kept: string[] = [];

  for (const declaration of splitDeclarations(withoutComments)) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    // `!important` is dropped rather than rejected: it changes nothing about what the
    // declaration is allowed to do, and imported documents use it liberally.
    const value = declaration
      .slice(separator + 1)
      .replace(/!\s*important/gi, "")
      .trim();

    if (!property || !value) continue;
    // Custom properties (`--x`) can be read back by any other declaration, so they route
    // around the property allow-list entirely.
    if (property.startsWith("--")) continue;
    if (!isAllowedProperty(property)) continue;
    if (DENIED_VALUE_PATTERNS.some((pattern) => pattern.test(value))) continue;
    if (property === "display" && !ALLOWED_DISPLAY_VALUES.has(value.toLowerCase())) continue;

    kept.push(`${property}: ${value}`);
  }

  return kept.join("; ");
};

/**
 * Rehype plugin that rewrites every element's `style` attribute to a whitelisted subset of
 * CSS properties, dropping the attribute when nothing survives.
 *
 * It must run after `rehype-raw` (so authored HTML has become real elements) and *before*
 * `rehype-sanitize`, which is what actually permits `style` on a tag — by then the value it
 * sees has already been normalized here.
 *
 * Note this only handles inline `style`. HTML that styles itself through `class` is a
 * separate matter: ToucanShelf never loads a document's stylesheet, so such markup would
 * render structurally intact but visually stripped, which is worse than not rendering it.
 * That case is handled on the content side, by the import scripts.
 */
export const rehypeInlineStyle = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    const style = node.properties?.style;
    if (typeof style !== "string") return;

    const sanitized = sanitizeInlineStyle(style);
    if (sanitized) {
      node.properties.style = sanitized;
    } else {
      delete node.properties.style;
    }
  });
};
