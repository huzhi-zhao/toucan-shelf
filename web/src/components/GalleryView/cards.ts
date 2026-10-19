import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, isImage } from "@/utils/attachment";
import type { MemoProperty } from "@/utils/frontmatter";
import { propertyMap, propertyValueToString } from "./fields";
import type { GalleryBlock } from "./types";

// How a gallery block turns its matched documents into cards: their order and
// cover image. Shared by the web renderer and the mobile reader's read-only
// preview, so both always show the same cards in the same order.

// Pulls the first markdown image URL out of a document's content, used as a
// cover fallback when the doc has no image attachment.
const firstMarkdownImage = (content: string): string | undefined => {
  const match = content.match(/!\[[^\]]*\]\(([^)\s]+)/);
  return match?.[1];
};

// Resolves a `prop:<key>` cover value: an `attachments/...` resource name maps to
// the matching attachment thumbnail, anything else is treated as a raw image URL.
const propertyCoverUrl = (doc: Memo, props: Map<string, MemoProperty>, key: string): string | undefined => {
  const prop = props.get(key);
  const value = prop ? propertyValueToString(prop) : "";
  if (!value) return undefined;
  const attachment = doc.attachments.find((a) => a.name === value || a.filename === value);
  return attachment ? getAttachmentThumbnailUrl(attachment) : value;
};

// Fallback used when the configured cover rule finds no image: the document's
// first image attachment, or its first inline markdown image.
const documentFirstImage = (doc: Memo): string | undefined => {
  const imageAttachment = doc.attachments.find((a) => isImage(a.type));
  if (imageAttachment) return getAttachmentThumbnailUrl(imageAttachment);
  if (doc.docType === Memo_DocType.MARKDOWN) return firstMarkdownImage(doc.content);
  return undefined;
};

export const coverUrl = (doc: Memo, props: Map<string, MemoProperty>, block: GalleryBlock): string | undefined => {
  if (block.cover === "none") return undefined;
  if (block.cover.startsWith("prop:")) {
    const propCover = propertyCoverUrl(doc, props, block.cover.slice(5));
    return propCover || documentFirstImage(doc);
  }
  const propCover = propertyCoverUrl(doc, props, "cover");
  return propCover || documentFirstImage(doc);
};

// Reads a document's value for a frontmatter property as a plain string ("" when
// the property is absent or empty).
const propertyValueOf = (doc: Memo, key: string): string => {
  const prop = propertyMap(doc.content).get(key);
  return prop ? propertyValueToString(prop) : "";
};

// Case-insensitive, numeric-aware comparison of two present property values.
const comparePresentValues = (as: string, bs: string): number => {
  const an = Number(as);
  const bn = Number(bs);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
};

export const sortDocs = (docs: Memo[], block: GalleryBlock): Memo[] => {
  const ts = (t?: { seconds: bigint }) => Number(t?.seconds ?? 0n);
  const sorted = [...docs];
  const propSort = block.sort.match(/^prop_(asc|desc):(.*)$/s);
  if (propSort) {
    const [, direction, key] = propSort;
    const factor = direction === "asc" ? 1 : -1;
    return sorted.sort((a, b) => {
      const as = propertyValueOf(a, key);
      const bs = propertyValueOf(b, key);
      // Documents missing the property always sort last, regardless of direction.
      if (as === "" || bs === "") {
        if (as === bs) return 0;
        return as === "" ? 1 : -1;
      }
      return factor * comparePresentValues(as, bs);
    });
  }
  switch (block.sort) {
    case "updated_asc":
      return sorted.sort((a, b) => ts(a.updateTime) - ts(b.updateTime));
    case "created_desc":
      return sorted.sort((a, b) => ts(b.createTime) - ts(a.createTime));
    case "created_asc":
      return sorted.sort((a, b) => ts(a.createTime) - ts(b.createTime));
    case "title_asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return sorted.sort((a, b) => ts(b.updateTime) - ts(a.updateTime));
  }
};
