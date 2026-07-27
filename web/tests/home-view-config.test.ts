import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTION_ID,
  emptyHomeConfig,
  emptySection,
  parseHomeViewConfig,
  serializeHomeViewConfig,
} from "@/components/GalleryView/home";
import {
  ALL_WORKSPACES,
  DEFAULT_GALLERY_BLOCK,
  type GalleryScope,
  parseGalleryViewConfig,
  resolveScopeWorkspaces,
  serializeGalleryViewConfig,
} from "@/components/GalleryView/types";

const scope = (workspaces?: string[]): GalleryScope => ({ ...DEFAULT_GALLERY_BLOCK.scope, ...(workspaces ? { workspaces } : {}) });

describe("resolveScopeWorkspaces", () => {
  it("scopes to the view's own knowledge base when nothing is selected", () => {
    expect(resolveScopeWorkspaces(scope(), "workspaces/own")).toEqual({ filter: 'workspace == "workspaces/own"' });
  });

  it("treats an all-blank selection as no selection", () => {
    expect(resolveScopeWorkspaces(scope(["", "  "]), "workspaces/own")).toEqual({ filter: 'workspace == "workspaces/own"' });
  });

  it("drops the server-side filter entirely for every knowledge base", () => {
    expect(resolveScopeWorkspaces(scope([ALL_WORKSPACES]), "workspaces/own")).toEqual({});
  });

  it("lets the server filter a single named knowledge base", () => {
    expect(resolveScopeWorkspaces(scope(["workspaces/a"]), "workspaces/own")).toEqual({ filter: 'workspace == "workspaces/a"' });
  });

  it("narrows several named knowledge bases client-side, since the filter grammar has no `in`", () => {
    const { filter, allowed } = resolveScopeWorkspaces(scope(["workspaces/a", "workspaces/b"]), "workspaces/own");
    expect(filter).toBeUndefined();
    expect(allowed && [...allowed].sort()).toEqual(["workspaces/a", "workspaces/b"]);
  });

  it("ignores named bases once ALL is selected", () => {
    expect(resolveScopeWorkspaces(scope(["workspaces/a", ALL_WORKSPACES]), "workspaces/own")).toEqual({});
  });
});

describe("gallery scope workspaces round-trip", () => {
  it("keeps a workspace selection across serialize/parse", () => {
    const content = serializeGalleryViewConfig({
      viewType: "gallery",
      blocks: [{ ...DEFAULT_GALLERY_BLOCK, scope: scope(["workspaces/a", "workspaces/b"]) }],
    });
    const parsed = parseGalleryViewConfig(content);
    expect(parsed?.blocks[0].type === "gallery" && parsed.blocks[0].scope.workspaces).toEqual(["workspaces/a", "workspaces/b"]);
  });

  it("leaves the field absent for an ordinary view, so nothing about existing documents changes", () => {
    const content = serializeGalleryViewConfig({ viewType: "gallery", blocks: [DEFAULT_GALLERY_BLOCK] });
    expect(content).not.toContain("workspaces");
    const parsed = parseGalleryViewConfig(content);
    expect(parsed?.blocks[0].type === "gallery" && parsed.blocks[0].scope.workspaces).toBeUndefined();
  });

  it("deduplicates and trims a stored selection", () => {
    const parsed = parseGalleryViewConfig(
      JSON.stringify({
        viewType: "gallery",
        blocks: [{ type: "gallery", scope: { match: "all", groups: [], workspaces: [" workspaces/a ", "workspaces/a", "", 7] } }],
      }),
    );
    expect(parsed?.blocks[0].type === "gallery" && parsed.blocks[0].scope.workspaces).toEqual(["workspaces/a"]);
  });
});

describe("parseHomeViewConfig", () => {
  it("round-trips sections, including their blocks and frontmatter", () => {
    const config = {
      viewType: "home" as const,
      sections: [
        { id: "s1", title: "Work", blocks: [{ ...DEFAULT_GALLERY_BLOCK, scope: scope([ALL_WORKSPACES]) }] },
        emptySection("Life", "s2"),
      ],
      frontmatter: "title: Home",
    };
    const parsed = parseHomeViewConfig(serializeHomeViewConfig(config), "General");
    expect(parsed?.sections.map((s) => [s.id, s.title])).toEqual([
      ["s1", "Work"],
      ["s2", "Life"],
    ]);
    expect(parsed?.sections[0].blocks).toHaveLength(1);
    expect(parsed?.sections[1].blocks).toEqual([]);
    expect(parsed?.frontmatter).toBe("title: Home");
  });

  it("reads a pre-sections document as one default section", () => {
    const parsed = parseHomeViewConfig(JSON.stringify({ viewType: "home", blocks: [DEFAULT_GALLERY_BLOCK] }), "General");
    expect(parsed?.sections).toHaveLength(1);
    expect(parsed?.sections[0].id).toBe(DEFAULT_SECTION_ID);
    expect(parsed?.sections[0].title).toBe("General");
    expect(parsed?.sections[0].blocks).toHaveLength(1);
  });

  it("never yields a tab-less page", () => {
    const parsed = parseHomeViewConfig(JSON.stringify({ viewType: "home", sections: [] }), "General");
    expect(parsed?.sections).toHaveLength(1);
    expect(parsed?.sections[0].blocks).toEqual([]);
  });

  it("names an untitled section after the default", () => {
    const parsed = parseHomeViewConfig(JSON.stringify({ viewType: "home", sections: [{ id: "s1" }] }), "General");
    expect(parsed?.sections[0].title).toBe("General");
  });

  it("returns undefined when there is no config to read", () => {
    expect(parseHomeViewConfig("", "General")).toBeUndefined();
    expect(parseHomeViewConfig("not json", "General")).toBeUndefined();
    expect(parseHomeViewConfig(JSON.stringify({ viewType: "home" }), "General")).toBeUndefined();
  });

  it("starts a fresh Home page on one empty section", () => {
    const parsed = parseHomeViewConfig(serializeHomeViewConfig(emptyHomeConfig("General")), "General");
    expect(parsed?.sections).toEqual([{ id: DEFAULT_SECTION_ID, title: "General", blocks: [] }]);
  });

  it("does not double the frontmatter fence when the author typed their own", () => {
    const content = serializeHomeViewConfig({ ...emptyHomeConfig("General"), frontmatter: "---\ntitle: Home\n---" });
    expect(content.startsWith("---\ntitle: Home\n---\n{")).toBe(true);
    expect(parseHomeViewConfig(content, "General")?.frontmatter).toBe("title: Home");
  });
});
