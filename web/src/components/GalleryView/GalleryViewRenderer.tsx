import { LayoutGridIcon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, isImage } from "@/utils/attachment";
import type { MemoProperty } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { fieldValue, matchesPropertyFilters, propertyMap, propertyValueToString } from "./fields";
import { type GalleryBlock, parseGalleryViewConfig } from "./types";

interface Props {
  memo: Memo;
  /** How a card click opens the target document. Defaults to navigating to the memo detail page. */
  onOpenDoc?: (memoName: string) => void;
  className?: string;
}

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

const coverUrl = (doc: Memo, props: Map<string, MemoProperty>, block: GalleryBlock): string | undefined => {
  if (block.cover === "none") return undefined;
  if (block.cover.startsWith("prop:")) return propertyCoverUrl(doc, props, block.cover.slice(5));
  const imageAttachment = doc.attachments.find((a) => isImage(a.type));
  if (imageAttachment) return getAttachmentThumbnailUrl(imageAttachment);
  if (doc.docType === Memo_DocType.MARKDOWN) return firstMarkdownImage(doc.content);
  return undefined;
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

const sortDocs = (docs: Memo[], block: GalleryBlock): Memo[] => {
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

interface BlockProps {
  block: GalleryBlock;
  memo: Memo;
  openDoc: (memoName: string) => void;
}

// Renders one gallery block: optional markdown intro (existing markdown
// pipeline, including sanitization), then a card wall built by querying the
// block's scope live — nothing is generated or cached.
const GalleryBlockView = ({ block, memo, openDoc }: BlockProps) => {
  const t = useTranslate();
  const scopeFilter =
    block.scope.type === "tag" ? `tag in [${JSON.stringify(block.scope.tag)}]` : `workspace == ${JSON.stringify(memo.workspace)}`;

  const { data, isLoading } = useMemos({ pageSize: 1000, state: State.NORMAL, filter: scopeFilter });

  const docs = useMemo(() => {
    let list = (data?.memos ?? []).filter((m) => m.name !== memo.name && m.docType !== Memo_DocType.VIEW);
    if (block.scope.type === "folder") {
      list = list.filter((m) => m.workspace === memo.workspace && m.folderPath === memo.folderPath);
    } else if (block.scope.type === "property") {
      const filters = block.scope.filters;
      list = list.filter((m) => matchesPropertyFilters(propertyMap(m.content), filters));
    }
    return sortDocs(list, block);
  }, [data, block, memo.name, memo.workspace, memo.folderPath]);

  return (
    <div className="w-full flex flex-col gap-4">
      {block.description && <MemoContent content={block.description} memoName={memo.name} />}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("gallery.loading")}</div>
      ) : docs.length === 0 ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <LayoutGridIcon className="w-4 h-4" />
          {t("gallery.empty")}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {docs.map((doc) => {
            const props = propertyMap(doc.content);
            const cover = coverUrl(doc, props, block);
            const primary = fieldValue(doc, props, block.cardFields.primary) || doc.title || doc.name;
            const secondary = fieldValue(doc, props, block.cardFields.secondary);
            return (
              <button
                key={doc.name}
                type="button"
                className="flex flex-col rounded-lg border border-border overflow-hidden text-left bg-card hover:shadow-md hover:border-accent transition-all"
                onClick={() => openDoc(doc.name)}
              >
                <div className="w-full aspect-[2/1] bg-muted flex items-center justify-center overflow-hidden">
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <LayoutGridIcon className="w-8 h-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="text-sm font-medium truncate">{primary}</div>
                  {secondary && <div className="text-xs text-muted-foreground truncate">{secondary}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Renders a VIEW document: each configured gallery block top-to-bottom,
// separated by dividers.
const GalleryViewRenderer = ({ memo, onOpenDoc, className }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const config = parseGalleryViewConfig(memo.content);

  if (!config) {
    return <div className={cn("text-sm text-muted-foreground", className)}>{t("gallery.not-configured")}</div>;
  }

  const openDoc = onOpenDoc ?? ((name: string) => navigate(`/${name}`));

  return (
    <div className={cn("w-full flex flex-col gap-6", className)}>
      {config.blocks.map((block, index) => (
        <div key={index} className="flex flex-col gap-6">
          {index > 0 && <hr className="border-border" />}
          <GalleryBlockView block={block} memo={memo} openDoc={openDoc} />
        </div>
      ))}
    </div>
  );
};

export default GalleryViewRenderer;
