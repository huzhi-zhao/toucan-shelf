import { describe, expect, it } from "vitest";
import { parseBlogBlocks } from "@/components/BlogSite/blocks";
import type { BlogGalleryBlock, BlogPost } from "@/components/BlogSite/types";
import { selectPosts } from "@/components/BlogSite/types";

const view = (blocks: unknown[]) => JSON.stringify({ viewType: "gallery", blocks });

describe("parseBlogBlocks", () => {
  it("reads the outward-facing block types", () => {
    const blocks = parseBlogBlocks(
      view([
        { type: "markdown", content: "# Welcome" },
        { type: "public_gallery", tags: ["guide"], sort: "manual", slugs: ["a", "b"], limit: 4, columns: 2 },
        { type: "public_feed", title: "Notes", tags: [], showTopicFilter: false, limit: 10 },
      ]),
    );
    expect(blocks).toEqual([
      { type: "markdown", content: "# Welcome" },
      { type: "gallery", tags: ["guide"], sort: "manual", slugs: ["a", "b"], limit: 4, columns: 2 },
      { type: "feed", title: "Notes", tags: [], showTopicFilter: false, limit: 10 },
    ]);
  });

  it("drops blocks that belong to the knowledge base", () => {
    // A gallery block's rules are folders and frontmatter properties; a snapshot
    // has neither, and running them out here would mean querying documents.
    // A markdown block pointing at another document is not part of this snapshot.
    const blocks = parseBlogBlocks(
      view([
        { type: "gallery", scope: { match: "all", groups: [] } },
        { type: "calendar", scope: { match: "all", groups: [] } },
        { type: "markdown", content: "", docName: "memos/abc" },
        { type: "markdown", content: "   " },
        { type: "public_feed" },
      ]),
    );
    expect(blocks).toEqual([{ type: "feed", title: "Latest", tags: [], showTopicFilter: true, limit: undefined }]);
  });

  it("falls back to defaults instead of throwing on a malformed field", () => {
    const [block] = parseBlogBlocks(
      view([{ type: "public_gallery", tags: "guide", sort: "alphabetical", limit: -3, columns: 7, slugs: [1, "a"] }]),
    );
    expect(block).toEqual({ type: "gallery", tags: [], sort: "updated_desc", slugs: ["a"], limit: undefined, columns: 3 });
  });

  it("returns nothing for content that is not a view document, so the caller can fall back", () => {
    for (const content of ["", "# just a page", "{not json", JSON.stringify({ viewType: "gallery" }), "null"]) {
      expect(parseBlogBlocks(content)).toEqual([]);
    }
  });

  it("reads a snapshot that still carries frontmatter", () => {
    // Snapshots taken before the pipeline stripped frontmatter keep it.
    const content = `---\ntitle: Home\n---\n${view([{ type: "public_feed", title: "Latest" }])}`;
    expect(parseBlogBlocks(content)).toHaveLength(1);
  });

  it("keeps a manual gallery that lists no slugs showing something", () => {
    const [block] = parseBlogBlocks(view([{ type: "public_gallery", sort: "manual" }]));
    expect(block).toMatchObject({ sort: "updated_desc" });
  });
});

describe("selectPosts", () => {
  const post = (slug: string, tags: string[], day: number): BlogPost => ({
    slug,
    title: slug,
    tags,
    updatedAt: new Date(2026, 0, day),
  });
  const posts = [post("a", ["guide"], 1), post("b", ["guide", "api"], 3), post("c", [], 2)];

  it("requires every tag on the block", () => {
    const block: BlogGalleryBlock = { type: "gallery", tags: ["guide", "api"], sort: "updated_desc", columns: 3 };
    expect(selectPosts(posts, block).map((p) => p.slug)).toEqual(["b"]);
  });

  it("orders by last update, newest first, and honours the limit", () => {
    const block: BlogGalleryBlock = { type: "gallery", tags: [], sort: "updated_desc", limit: 2, columns: 3 };
    expect(selectPosts(posts, block).map((p) => p.slug)).toEqual(["b", "c"]);
  });

  it("skips a manually listed slug that is no longer published", () => {
    const block: BlogGalleryBlock = { type: "gallery", tags: [], sort: "manual", slugs: ["c", "gone", "a"], columns: 3 };
    expect(selectPosts(posts, block).map((p) => p.slug)).toEqual(["c", "a"]);
  });
});
