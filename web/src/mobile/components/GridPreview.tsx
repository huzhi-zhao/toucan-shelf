import { ChevronRightIcon, LayoutGridIcon } from "lucide-react";
import { useMemo } from "react";
import { GridCardLink } from "@/components/MemoContent/grid/GridCardLink";
import { gridCardKind, gridHidesCovers, textCardSlots } from "@/components/MemoContent/grid/layout";
import { type GridCardData, parseGridBlock } from "@/components/MemoContent/grid/parseGridBlock";
import { cn } from "@/lib/utils";
import { COPY } from "../copy";

const CARD_CLASS =
  "relative flex flex-col overflow-hidden rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] text-left";
const LINKED_CLASS = "active:opacity-60";
const MUTED = "text-black/50 dark:text-white/50";

/**
 * A ```grid block on the phone, read-only (phase 3 §4). The same cards, layouts and
 * fields as the web grid, sized for a phone the way the gallery preview is: cover
 * cards two to a row, text cards one to a row, two-line strips as one list. A
 * fixed `columns: N` is for a wide screen and is not followed here. A card with a
 * `url` opens it the way the web card does: a document in the reader, an anchor
 * in the page, anything else in a new tab.
 */
export default function GridPreview({ content }: { content: string }) {
  const data = useMemo(() => parseGridBlock(content), [content]);
  if (data.cards.length === 0) {
    return <div className="not-prose text-[15px] text-black/45 dark:text-white/45">{COPY.blockPreview.gridEmpty}</div>;
  }

  if (data.style === "longbar") {
    return (
      <div className="not-prose overflow-hidden rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] divide-y divide-black/[0.08] dark:divide-white/[0.1]">
        {data.cards.map((card, index) => (
          <GridCardLink key={index} url={card.url} className="flex items-center gap-2 px-3 py-2.5 text-left" linkedClassName={LINKED_CLASS}>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium truncate">{card.title}</div>
              {card.subtitle && <div className={cn("text-[13px] truncate", MUTED)}>{card.subtitle}</div>}
            </div>
            {card.url && <ChevronRightIcon className="w-4 h-4 shrink-0 text-black/25 dark:text-white/30" />}
          </GridCardLink>
        ))}
      </div>
    );
  }

  const hideCovers = gridHidesCovers(data);
  return (
    <div className="not-prose grid grid-cols-2 gap-3">
      {data.cards.map((card, index) =>
        gridCardKind(card, false, hideCovers) === "cover" ? (
          <GridCardLink key={index} url={card.url} className={CARD_CLASS} linkedClassName={LINKED_CLASS}>
            <CoverCard card={card} />
          </GridCardLink>
        ) : (
          <GridCardLink key={index} url={card.url} className={cn(CARD_CLASS, "col-span-2 px-3.5 py-3")} linkedClassName={LINKED_CLASS}>
            <TextCard card={card} />
          </GridCardLink>
        ),
      )}
    </div>
  );
}

function CoverCard({ card }: { card: GridCardData }) {
  return (
    <>
      <div className="w-full aspect-[3/2] bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center overflow-hidden">
        {card.cover ? (
          <img src={card.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <LayoutGridIcon className="w-7 h-7 text-black/20 dark:text-white/25" />
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2 min-w-0">
        <div className="text-[14px] font-medium leading-snug line-clamp-2">{card.title}</div>
        {card.subtitle && <div className={cn("text-[12px] truncate", MUTED)}>{card.subtitle}</div>}
        {card.fields.map((field, index) => (
          <div key={index} className={cn("truncate", index === 0 ? "text-[13px] font-semibold" : cn("text-[12px]", MUTED))}>
            {field.value}
          </div>
        ))}
      </div>
    </>
  );
}

/** A card without a cover: a larger title, the lead value emphasised, other fields two to a row, the last one as a footer. */
function TextCard({ card }: { card: GridCardData }) {
  const { rows, footer } = textCardSlots(card);
  return (
    <>
      <div className="text-[17px] font-semibold leading-snug line-clamp-2">{card.title}</div>
      {card.subtitle && <div className={cn("mt-0.5 text-[13px] truncate", MUTED)}>{card.subtitle}</div>}
      {rows.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-2 gap-2 items-baseline">
              <span className={cn("truncate", rowIndex === 0 ? "text-[16px] font-bold tabular-nums" : cn("text-[14px]", MUTED))}>
                {row.left?.value ?? ""}
              </span>
              {row.right && <span className={cn("truncate text-right text-[14px] tabular-nums", MUTED)}>{row.right.value}</span>}
            </div>
          ))}
        </div>
      )}
      {footer && <div className={cn("mt-2 text-[12px] truncate text-right tabular-nums", MUTED)}>{footer.value}</div>}
    </>
  );
}
