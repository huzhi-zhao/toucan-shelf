import type TurndownService from "turndown";
import { withChunkReload } from "./dynamicImport";

// Converts clipboard HTML (a web page selection, an LLM answer, a Word paste) into
// Markdown. Kept editor-agnostic and side-effect free so it can be unit tested with
// real-world fixtures and reused outside the memo editor.
//
// turndown handles the structural mapping; everything specific to *clipboard* HTML —
// KaTeX, Office wrappers, base-less relative URLs — is normalized in the DOM first,
// so the turndown rules stay small and predictable.

/** Tags whose presence means the HTML carries structure the plain-text flavor lost. */
const STRUCTURAL_TAG_RE = /<(a|strong|b|em|i|code|pre|h[1-6]|ul|ol|li|table|img|blockquote|del|s|hr)[\s>/]/i;

/** Elements dropped outright, content included. */
const DROPPED_SELECTOR = "script,style,noscript,template,link,meta,title,iframe,object,embed";

const ABSOLUTE_URL_RE = /^(https?:|data:|mailto:|tel:)/i;

const MATH_ATTR = "data-toucan-math";
const LANG_ATTR = "data-toucan-lang";

/**
 * True when the plain-text flavor of the clipboard is already Markdown — an LLM answer,
 * a README, a code editor selection. Converting it would only escape its own syntax
 * (`#` → `\#`), so the caller should paste it verbatim.
 */
export function looksLikeMarkdown(plain: string): boolean {
  if (!plain) return false;
  if (/^\s*(```|~~~)/m.test(plain)) return true;
  if (/^#{1,6}\s+\S/m.test(plain)) return true;
  if (/^\s*\|.*\|\s*$/m.test(plain) && /^\s*\|?[\s:]*-{3,}/m.test(plain)) return true;
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(plain)) return true;
  if (/^\s*>\s+\S/m.test(plain)) return true;
  const bullets = plain.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  if (bullets >= 2) return true;
  const ordered = plain.match(/^\s*\d+\.\s+\S/gm)?.length ?? 0;
  return ordered >= 2;
}

/**
 * Decides whether the HTML flavor is worth converting. See
 * `docs/dev/requirements/editor/html-paste-to-markdown.md` for why each bail-out exists.
 */
export function shouldConvertHtml(html: string, plain: string): boolean {
  if (!html || !html.trim()) return false;
  if (looksLikeMarkdown(plain)) return false;
  return STRUCTURAL_TAG_RE.test(html);
}

let servicePromise: Promise<TurndownService> | null = null;

async function getService(): Promise<TurndownService> {
  if (!servicePromise) {
    servicePromise = withChunkReload(async () => {
      const [{ default: Turndown }, gfm] = await Promise.all([import("turndown"), import("turndown-plugin-gfm")]);
      const service = new Turndown({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
        strongDelimiter: "**",
        linkStyle: "inlined",
      });
      service.use(gfm.gfm);
      addRules(service);
      return service;
    }).catch((error) => {
      // Don't cache the failure: a transient network hiccup shouldn't disable
      // conversion for the rest of the session.
      servicePromise = null;
      throw error;
    });
  }
  return servicePromise;
}

/** Warms the turndown chunk so the first paste doesn't wait on a network round-trip. */
export function preloadHtmlToMarkdown(): void {
  void getService().catch(() => {
    // Preload is best-effort; the paste path reports failures on its own.
  });
}

function addRules(service: TurndownService): void {
  // Math extracted from KaTeX by `normalize`, carried on a <code> element so turndown
  // leaves the TeX alone (text nodes would get their `_`, `*` and `\` escaped).
  service.addRule("toucanMath", {
    filter: (node) => node.nodeName === "CODE" && node.hasAttribute(MATH_ATTR),
    replacement: (_content, node) => {
      const tex = (node.textContent ?? "").trim();
      if (!tex) return "";
      return (node as Element).getAttribute(MATH_ATTR) === "display" ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    },
  });

  // turndown pads list markers to four columns ("-   item"). Valid, but it doesn't match
  // what the editor itself writes, and the padding survives every later edit of the doc.
  service.addRule("toucanListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const parent = node.parentNode as Element | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? 1);
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${(Number.isNaN(start) ? 1 : start) + index}. `;
      }
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  // Fenced code with the language recovered by `normalize`. Replaces turndown's own
  // fenced rule, which only understands `class="language-x"` on the <code> element.
  service.addRule("toucanFencedCode", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector("code") ?? element;
      const text = (code.textContent ?? "").replace(/\n+$/, "");
      const longestRun = text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      const lang = element.getAttribute(LANG_ATTR) ?? "";
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });
}

/** Absolute, or a fragment link that stays meaningful as text. */
function isUsableUrl(url: string | null): boolean {
  return !!url && ABSOLUTE_URL_RE.test(url.trim());
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function detectLanguage(pre: HTMLElement): string {
  const code = pre.querySelector("code");
  const candidates = [pre, code, pre.parentElement].filter(Boolean) as HTMLElement[];
  for (const element of candidates) {
    const explicit = element.getAttribute("data-language") ?? element.getAttribute("data-lang");
    if (explicit) return explicit.trim().toLowerCase();
    for (const name of Array.from(element.classList)) {
      const match = /^(?:language|lang|highlight-source|hljs)-([\w+#.-]+)$/.exec(name);
      if (match && match[1] !== "hljs") return match[1].toLowerCase();
    }
  }
  return "";
}

/** Rewrites clipboard-specific quirks into something turndown can map cleanly. */
function normalize(root: HTMLElement): void {
  root.querySelectorAll(DROPPED_SELECTOR).forEach((element) => element.remove());

  // Office/WPS namespaced tags (<o:p>, <w:sdt>, <v:shape>) and their `mso-` shells.
  root.querySelectorAll("*").forEach((element) => {
    if (element.tagName.includes(":")) element.remove();
  });

  // KaTeX renders the same formula twice: MathML (with the original TeX in an
  // annotation) plus an HTML tree of positioned glyphs. Keep the TeX, drop the glyphs.
  root.querySelectorAll(".katex").forEach((element) => {
    if (!element.isConnected) return;
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    const display = element.closest(".katex-display");
    const target = display ?? element;
    if (!tex) {
      target.remove();
      return;
    }
    const holder = root.ownerDocument.createElement("code");
    holder.setAttribute(MATH_ATTR, display ? "display" : "inline");
    holder.textContent = tex;
    target.replaceWith(holder);
  });
  // MathML left over from non-KaTeX renderers carries no TeX worth keeping.
  root.querySelectorAll("math").forEach((element) => element.remove());

  root.querySelectorAll("pre").forEach((pre) => {
    const lang = detectLanguage(pre as HTMLElement);
    if (lang) pre.setAttribute(LANG_ATTR, lang);
  });

  // The clipboard carries no base URL, so a relative path cannot be resolved. A broken
  // image or a link that 404s is worse than none; keep the text, drop the address.
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!isUsableUrl(src)) img.remove();
  });
  root.querySelectorAll("a").forEach((anchor) => {
    if (!isUsableUrl(anchor.getAttribute("href"))) anchor.removeAttribute("href");
  });

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const text of texts) {
    text.data = text.data.replace(/\u00a0/g, " ").replace(/\u200b|\ufeff/g, "");
  }

  // Presentational inline shells (page builders emit them by the dozen, and the removals
  // above leave more behind). Only spans are unwrapped: block elements carry the
  // paragraph boundaries turndown relies on, so `div`/`section` must stay.
  root.querySelectorAll("span,font").forEach((element) => unwrap(element));
}

/** Converts a clipboard HTML fragment to Markdown. Loads turndown on first use. */
export async function htmlToMarkdown(html: string): Promise<string> {
  const service = await getService();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  normalize(parsed.body);
  return service
    .turndown(parsed.body.innerHTML)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
