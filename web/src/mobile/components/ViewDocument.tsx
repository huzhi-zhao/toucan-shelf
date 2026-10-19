import { LayoutGridIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { coverUrl } from "@/components/GalleryView/cards";
import { contentPreviewLines, fieldValue, propertyMap, textCardProperties } from "@/components/GalleryView/fields";
import { type GalleryBadgeRule, type GalleryBlock, matchGalleryBadge, parseGalleryViewConfig } from "@/components/GalleryView/types";
import { useGalleryDocs } from "@/components/GalleryView/useScopeMemos";
import MemoContent from "@/components/MemoContent";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { COPY } from "../copy";
import BlockPlaceholderCard from "./BlockPlaceholderCard";
import DocGlyph from "./DocGlyph";

interface Props {
  memo: Memo;
  /** Opens a document in the reader. */
  onOpen: (memoName: string) => void;
  /** Shown for blocks the phone does not render yet. */
  onCopyDesktopLink: () => void;
  /** The reading settings (font size, line height). Applied to text blocks only: card walls keep their size. */
  textStyle?: CSSProperties;
}

/**
 * A VIEW document on the phone, read-only (phase 3 §4): each block top to bottom.
 * Gallery blocks become a card wall built from the same query, order, covers and
 * badges as the web renderer; text blocks go through the shared renderer, under
 * the providers the reading page already set up. Calendar layouts are not drawn
 * yet; outward-facing blocks belong to the public site and are left out.
 */
export default function ViewDocument({ memo, onOpen, onCopyDesktopLink, textStyle }: Props) {
  const config = parseGalleryViewConfig(memo.content);
  if (!config || config.blocks.length === 0) {
    return <div className="py-12 text-center text-[15px] text-black/45 dark:text-white/45">{COPY.reader.viewNotConfigured}</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      {config.blocks.map((block, index) => {
        switch (block.type) {
          case "gallery":
            return <GalleryCards key={index} block={block} view={memo} onOpen={onOpen} />;
          case "calendar":
            return <BlockPlaceholderCard key={index} title={COPY.blocks.calendarLayout} onCopyDesktopLink={onCopyDesktopLink} />;
          case "markdown":
            return (
              <div key={index} style={textStyle}>
                {block.docName ? (
                  <ReferencedDoc docName={block.docName} blockIndex={index} onOpen={onOpen} />
                ) : (
                  <MemoContent
                    content={block.content}
                    memoName={memo.name}
                    headingIdPrefix={`vb${index}`}
                    softBreak={memo.docConfig?.softBreak}
                    density="reading"
                    alwaysExpanded
                  />
                )}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/** A text block that shows another document: its title (tap to open it) over its content. */
function ReferencedDoc({ docName, blockIndex, onOpen }: { docName: string; blockIndex: number; onOpen: (memoName: string) => void }) {
  const { data: doc, isPending, isError } = useMemoQuery(docName);
  if (isPending) return <div className="text-[15px] text-black/45 dark:text-white/45">{COPY.reader.viewLoading}</div>;
  if (isError || !doc) return <div className="text-[15px] text-black/45 dark:text-white/45">{COPY.reader.viewDocMissing}</div>;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onOpen(doc.name)}
        className="self-start flex items-center gap-1.5 text-[15px] font-medium text-primary active:opacity-50"
      >
        <DocGlyph icon={doc.icon} size={18} />
        <span className="truncate">{doc.title || doc.name}</span>
      </button>
      <MemoContent
        content={doc.content}
        memoName={doc.name}
        headingIdPrefix={`vb${blockIndex}`}
        softBreak={doc.docConfig?.softBreak}
        showProperties={false}
        density="reading"
        alwaysExpanded
      />
    </div>
  );
}

/**
 * One gallery block as a card wall sized for a phone: cards with covers two to a
 * row, text-only cards (cover rule `none`) one to a row since they carry a few
 * lines of properties. Tapping a card opens that document in the reader.
 */
function GalleryCards({ block, view, onOpen }: { block: GalleryBlock; view: Memo; onOpen: (memoName: string) => void }) {
  const { docs, isLoading } = useGalleryDocs(block, view);
  const textOnly = block.cover === "none";

  if (isLoading) {
    return (
      <div className={cn("grid gap-3", textOnly ? "grid-cols-1" : "grid-cols-2")} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] animate-pulse" />
        ))}
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[15px] text-black/45 dark:text-white/45">
        <LayoutGridIcon className="w-4 h-4" />
        {COPY.reader.viewEmpty}
      </div>
    );
  }
  return (
    <div className={cn("grid gap-3", textOnly ? "grid-cols-1" : "grid-cols-2")}>
      {docs.map((doc) => {
        const props = propertyMap(doc.content);
        const primary = fieldValue(doc, props, block.cardFields.primary) || doc.title || doc.name;
        const secondary = fieldValue(doc, props, block.cardFields.secondary);
        const badge = matchGalleryBadge(block.badges, props);
        return (
          <button
            key={doc.name}
            type="button"
            onClick={() => onOpen(doc.name)}
            className={cn(
              "relative flex flex-col overflow-hidden rounded-xl text-left not-prose",
              "border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] active:opacity-60",
              badge?.kind === "tag" && "opacity-60 grayscale",
            )}
          >
            {badge && <CardBadge badge={badge} />}
            {textOnly ? (
              <TextCard doc={doc} block={block} props={props} primary={primary} secondary={secondary} badge={badge} />
            ) : (
              <>
                <Cover url={coverUrl(doc, props, block)} />
                <div className="flex flex-col gap-0.5 px-2.5 py-2 min-w-0">
                  <div className="text-[14px] font-medium leading-snug line-clamp-2">{primary}</div>
                  {secondary && <div className="text-[12px] text-black/50 dark:text-white/50 truncate">{secondary}</div>}
                </div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Cover({ url }: { url?: string }) {
  return (
    <div className="w-full aspect-[3/2] bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center overflow-hidden">
      {url ? (
        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <LayoutGridIcon className="w-7 h-7 text-black/20 dark:text-white/25" />
      )}
    </div>
  );
}

function TextCard({
  doc,
  block,
  props,
  primary,
  secondary,
  badge,
}: {
  doc: Memo;
  block: GalleryBlock;
  props: ReturnType<typeof propertyMap>;
  primary: string;
  secondary: string;
  badge?: GalleryBadgeRule;
}) {
  const rows = textCardProperties(props, block);
  const preview = rows.length === 0 ? contentPreviewLines(doc) : [];
  // The badge sits over the text here (there is no cover to carry it), so keep the text clear of its corner.
  const inset = badge?.kind === "ribbon" ? "pl-9" : badge?.kind === "tag" ? "pt-8" : badge?.kind === "corner" ? "pr-14" : undefined;
  let details: ReactNode = null;
  if (rows.length > 0) {
    details = rows.map((row) => (
      <div key={row.key} className="flex items-baseline gap-2 text-[13px] min-w-0">
        <span className="shrink-0 max-w-[40%] truncate text-black/45 dark:text-white/45">{row.key}</span>
        <span className="truncate">{row.value}</span>
      </div>
    ));
  } else if (preview.length > 0) {
    details = preview.map((line, i) => (
      <div key={i} className="text-[13px] leading-relaxed text-black/50 dark:text-white/50 truncate">
        {line}
      </div>
    ));
  }
  return (
    <div className={cn("flex flex-col gap-2 px-4 py-3.5 min-w-0", inset)}>
      <div className="flex flex-col gap-0.5">
        <div className="text-[17px] font-semibold leading-snug line-clamp-2">{primary}</div>
        {secondary && <div className="text-[14px] text-black/50 dark:text-white/50 truncate">{secondary}</div>}
      </div>
      {details && <div className="flex flex-col gap-0.5">{details}</div>}
    </div>
  );
}

/** The block's badge on a card, in the same three shapes as the web, sized for a narrow card. */
function CardBadge({ badge }: { badge: GalleryBadgeRule }) {
  if (!badge.title) return null;
  if (badge.kind === "tag") {
    return (
      <div
        className="absolute top-2 left-2 z-10 px-1.5 py-0.5 text-[11px] font-medium text-white rounded shadow-sm"
        style={{ backgroundColor: badge.color }}
      >
        {badge.title}
      </div>
    );
  }
  if (badge.kind === "ribbon") {
    return (
      <div
        className="absolute top-0 left-2 z-10 flex flex-col items-center px-1 pt-1 pb-3 text-[10px] font-semibold leading-none text-white shadow-sm"
        style={{ backgroundColor: badge.color, clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 88%, 0 100%)" }}
      >
        {badge.title.split("").map((ch, i) => (
          <span key={i} className="leading-[1.15]">
            {ch}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="absolute top-0 right-0 z-10 w-20 h-20 overflow-hidden pointer-events-none">
      <div
        className="absolute top-[14px] right-[-28px] w-[120px] rotate-45 text-center text-[11px] font-medium text-white py-0.5 shadow-sm"
        style={{ backgroundColor: badge.color }}
      >
        {badge.title}
      </div>
    </div>
  );
}
