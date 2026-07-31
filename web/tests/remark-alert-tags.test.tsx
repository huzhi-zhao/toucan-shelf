import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { resolveAlertFamily } from "@/components/MemoContent/markdown/alertFamilies";
import { tagColorClasses } from "@/components/MemoContent/markdown/tagPalette";
import { remarkAlert } from "@/utils/remark-plugins/remark-alert";

interface TagPayload {
  label: string;
  color?: string;
  icon?: string;
}

// Same plugin order as the real renderer; the blockquote's hProperties surface
// as `data-alert*` attributes once serialized, which is what we assert on.
const renderMarkdown = (content: string): string =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkAlert]}>{content}</ReactMarkdown>);

const attr = (html: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`).exec(html);
  return match?.[1];
};

/** `data-alert-tags` holds HTML-escaped JSON; unescape the quotes before parsing. */
const tagsOf = (content: string): TagPayload[] => {
  const raw = attr(renderMarkdown(content), "data-alert-tags");
  return raw ? JSON.parse(raw.replace(/&quot;/g, '"')) : [];
};

describe("remarkAlert tag rows", () => {
  it("parses one chip per line with color and icon", () => {
    const tags = tagsOf(["> [!TAGS]", "> [gray(⚙️)] Github", "> [orange(🦊)] Gitlab", "> [arcoblue] Twitter"].join("\n"));

    expect(tags).toEqual([
      { label: "Github", color: "gray", icon: "⚙️" },
      { label: "Gitlab", color: "orange", icon: "🦊" },
      { label: "Twitter", color: "arcoblue" },
    ]);
  });

  it("accepts a chip on the marker line and an icon-only, empty or absent marker", () => {
    const tags = tagsOf(["> [!TAGS] [blue] first", "> [] bare", "> [(✨)] icon only", "> no marker"].join("\n"));

    expect(tags).toEqual([
      { label: "first", color: "blue" },
      { label: "bare" },
      { label: "icon only", icon: "✨" },
      { label: "no marker" },
    ]);
  });

  it("flattens inline markup in a label to plain text", () => {
    expect(tagsOf(["> [!TAGS]", "> [green] **bold** and `code`"].join("\n"))).toEqual([{ label: "bold and code", color: "green" }]);
  });

  it("keeps the variant suffix on data-alert so the row can pick its skin", () => {
    const html = renderMarkdown(["> [!TAGS:bordered]", "> [blue] Twitter"].join("\n"));

    expect(attr(html, "data-alert")).toBe("tags:bordered");
    expect(resolveAlertFamily("tags:bordered")).toBe("tags-bordered");
    expect(resolveAlertFamily("tags:filled")).toBe("tags-filled");
  });

  it("emits no payload for a tag block with no lines", () => {
    expect(attr(renderMarkdown("> [!TAGS]"), "data-alert-tags")).toBeUndefined();
  });

  it("falls back to the default skin for an unknown color name, and is case-insensitive", () => {
    expect(tagColorClasses("chartreuse", "light")).toBe(tagColorClasses("default", "light"));
    expect(tagColorClasses("BLUE", "filled")).toBe(tagColorClasses("blue", "filled"));
  });
});
