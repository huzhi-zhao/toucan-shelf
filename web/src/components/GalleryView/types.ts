// Structured configuration stored as the content of a VIEW document.
// The content holds ONLY this JSON (plus an optional markdown description
// field inside it) — never HTML or rendered output. The gallery itself is
// rendered live from current data every time the document is opened.

export type GalleryScope = { type: "folder" } | { type: "tag"; tag: string };

export type GallerySort = "updated_desc" | "updated_asc" | "created_desc" | "created_asc" | "title_asc";

export type GalleryCoverRule = "first_image" | "none";

export interface GalleryViewConfig {
  viewType: "gallery";
  /** Optional markdown intro rendered above the gallery via the existing markdown pipeline. */
  description?: string;
  /** Which documents to show: direct siblings in the view doc's folder, or all docs with a tag. */
  scope: GalleryScope;
  sort: GallerySort;
  cover: GalleryCoverRule;
}

export const DEFAULT_GALLERY_CONFIG: GalleryViewConfig = {
  viewType: "gallery",
  scope: { type: "folder" },
  sort: "updated_desc",
  cover: "first_image",
};

/**
 * Parses a VIEW document's content. Returns undefined when no view style has
 * been chosen yet (empty/invalid content), so the editor can show the style
 * picker step.
 */
export function parseGalleryViewConfig(content: string): GalleryViewConfig | undefined {
  if (!content.trim()) return undefined;
  try {
    const raw = JSON.parse(content);
    if (!raw || typeof raw !== "object" || raw.viewType !== "gallery") return undefined;
    const scope: GalleryScope =
      raw.scope?.type === "tag" && typeof raw.scope.tag === "string" ? { type: "tag", tag: raw.scope.tag } : { type: "folder" };
    const sorts: GallerySort[] = ["updated_desc", "updated_asc", "created_desc", "created_asc", "title_asc"];
    return {
      viewType: "gallery",
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description : undefined,
      scope,
      sort: sorts.includes(raw.sort) ? raw.sort : DEFAULT_GALLERY_CONFIG.sort,
      cover: raw.cover === "none" ? "none" : "first_image",
    };
  } catch {
    return undefined;
  }
}

export function serializeGalleryViewConfig(config: GalleryViewConfig): string {
  return JSON.stringify(config, null, 2);
}
