import { LayoutGridIcon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { type BlockSourceValue, BlockSourceProvider } from "@/components/MemoContent/BlockSourceContext";
import { PropertiesPanel } from "@/components/MemoContent/PropertiesPanel";
import { useMemos, useUpdateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, isImage } from "@/utils/attachment";
import { type MemoProperty, parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { fieldValue, matchesScope, propertyMap, propertyValueToString } from "./fields";
import { type GalleryBadgeRule, type GalleryBlock, type MarkdownBlock, matchGalleryBadge, parseGalleryViewConfig, serializeGalleryViewConfig } from "./types";

interface Props {
  memo: Memo;
  /** How a card click opens the target document. Defaults to navigating to the memo detail page. */
  onOpenDoc?: (memoName: string) => void;
  /** Whether the viewer may edit interactive blocks inside the Intro/Note markdown. */
  readonly?: boolean;
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

// Fallback used when the configured cover rule finds no image: the document's
// first image attachment, or its first inline markdown image.
const documentFirstImage = (doc: Memo): string | undefined => {
  const imageAttachment = doc.attachments.find((a) => isImage(a.type));
  if (imageAttachment) return getAttachmentThumbnailUrl(imageAttachment);
  if (doc.docType === Memo_DocType.MARKDOWN) return firstMarkdownImage(doc.content);
  return undefined;
};

const coverUrl = (doc: Memo, props: Map<string, MemoProperty>, block: GalleryBlock): string | undefined => {
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

// Renders a block-configured badge as an overlay ribbon on a matching card.
// `tag` uses a flag/pennant shape in the top-left corner (also dims the card —
// used for "completed" style badges); `ribbon` a vertical folded ribbon in the
// top-left corner; `corner` a diagonal ribbon across the top-right corner.
const GalleryCardBadge = ({ badge }: { badge: GalleryBadgeRule }) => {
  if (!badge.title) return null;
  if (badge.kind === "tag") {
    return (
      <div
        className="absolute top-2 left-2 z-10 px-2 py-0.5 text-xs font-medium text-white rounded shadow-sm"
        style={{ backgroundColor: badge.color }}
      >
        {badge.title}
      </div>
    );
  }
  if (badge.kind === "ribbon") {
    return (
      <div
        className="absolute top-0 left-2 z-10 flex flex-col items-center px-1 pt-1 pb-3.5 text-[11px] font-semibold leading-none text-white shadow-sm"
        style={{
          backgroundColor: badge.color,
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 88%, 0 100%)",
        }}
      >
        {badge.title.split("").map((ch, i) => (
          <span key={i} className="leading-[1.15]">
            {ch}
          </span>
        ))}
      </div>
    );
  }
  // corner
  return (
    <div className="absolute top-0 right-0 z-10 w-24 h-24 overflow-hidden pointer-events-none">
      <div
        className="absolute top-[18px] right-[-30px] w-[140px] rotate-45 text-center text-xs font-medium text-white py-1 shadow-sm"
        style={{ backgroundColor: badge.color }}
      >
        {badge.title}
      </div>
    </div>
  );
};

// Renders a markdown block through the ordinary document pipeline, and lets the
// interactive blocks inside it (calendar, kanban, …) persist their edits: the
// rewritten markdown goes back into this block's `content`, and the whole config
// is re-serialized.
const MarkdownBlockView = ({ block, blockIndex, memo, readonly }: Omit<BlockProps, "block" | "openDoc"> & { block: MarkdownBlock }) => {
  const { mutate: updateMemo } = useUpdateMemo();

  const source = useMemo<BlockSourceValue>(
    () => ({
      source: block.content,
      readonly,
      save: (next: string) => {
        if (next === block.content) return;
        // Re-parse at save time so we never write back a stale copy of the config.
        const config = parseGalleryViewConfig(memo.content);
        if (config?.blocks[blockIndex]?.type !== "markdown") return;
        const blocks = config.blocks.map((b, i) => (i === blockIndex ? { ...b, content: next } : b));
        updateMemo({
          update: { name: memo.name, content: serializeGalleryViewConfig({ ...config, blocks }) },
          updateMask: ["content", "update_time"],
        });
      },
    }),
    [block.content, blockIndex, memo.content, memo.name, readonly, updateMemo],
  );

  return (
    <BlockSourceProvider value={source}>
      <MemoContent content={block.content} memoName={memo.name} headingIdPrefix={`vb${blockIndex}`} />
    </BlockSourceProvider>
  );
};

interface BlockProps {
  block: GalleryBlock;
  /** Index of this block within the view, used to keep heading ids unique across blocks. */
  blockIndex: number;
  memo: Memo;
  readonly: boolean;
  openDoc: (memoName: string) => void;
}


// Renders one gallery block: a card wall built by querying the block's scope
// live — nothing is generated or cached.
const GalleryBlockView = ({ block, memo, openDoc }: BlockProps) => {
  const t = useTranslate();
  const { data, isLoading } = useMemos({ pageSize: 1000, state: State.NORMAL, filter: `workspace == ${JSON.stringify(memo.workspace)}` });

  const docs = useMemo(() => {
    // VIEW docs are eligible too: they now carry frontmatter properties, so a
    // gallery can filter, sort and reference other views like any other doc.
    const ctx = { viewFolderPath: memo.folderPath };
    const list = (data?.memos ?? []).filter((m) => m.name !== memo.name && matchesScope(m, propertyMap(m.content), block.scope, ctx));
    return sortDocs(list, block);
  }, [data, block, memo.name, memo.folderPath]);

  return (
    <div className="w-full flex flex-col gap-4">
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
            const badge = matchGalleryBadge(block.badges, props);
            return (
              <button
                key={doc.name}
                type="button"
                className={cn(
                  "relative flex flex-col rounded-lg border border-border overflow-hidden text-left bg-card hover:shadow-md hover:border-accent transition-all",
                  badge?.kind === "tag" && "opacity-60 grayscale",
                )}
                onClick={() => openDoc(doc.name)}
              >
                {badge && <GalleryCardBadge badge={badge} />}
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

// Renders a VIEW document: each configured block top-to-bottom. No dividers are
// inserted between blocks — a markdown block can write its own `---` where one
// is actually wanted.
const GalleryViewRenderer = ({ memo, onOpenDoc, readonly = true, className }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const config = parseGalleryViewConfig(memo.content);
  const { properties } = useMemo(() => parseFrontmatter(memo.content), [memo.content]);

  if (!config) {
    return <div className={cn("text-sm text-muted-foreground", className)}>{t("gallery.not-configured")}</div>;
  }

  const openDoc = onOpenDoc ?? ((name: string) => navigate(`/${name}`));

  return (
    <div className={cn("w-full flex flex-col gap-6", className)}>
      <PropertiesPanel properties={properties} />
      {config.blocks.map((block, index) => (
        <div key={index} className="flex flex-col gap-6">
          {block.type === "markdown" ? (
            <MarkdownBlockView block={block} blockIndex={index} memo={memo} readonly={readonly} />
          ) : (
            <GalleryBlockView block={block} blockIndex={index} memo={memo} readonly={readonly} openDoc={openDoc} />
          )}
        </div>
      ))}
    </div>
  );
};

export default GalleryViewRenderer;
