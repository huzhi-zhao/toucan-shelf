import { cn } from "@/lib/utils";
import { GridCardLink } from "./GridCardLink";
import { gridCardKind, textCardSlots } from "./layout";
import type { GridCardData } from "./parseGridBlock";

interface GridCardProps {
  card: GridCardData;
  /** When true (block-level or auto), no cover is drawn even if the card has one. */
  nocover?: boolean;
  /** Two-line text strip instead of a cover card; implies no cover. */
  longbar?: boolean;
}

const CARD_CLASS = "relative flex flex-col rounded-lg border border-border overflow-hidden bg-card text-left";
const LINKED_CARD_CLASS = "hover:shadow-md hover:border-accent transition-all cursor-pointer";
const LONGBAR_CLASS =
  "relative flex flex-col justify-center rounded-lg border border-border bg-card text-left px-3.5 py-2.5 min-h-[3.25rem]";
const TEXT_CARD_CLASS =
  "relative flex flex-col rounded-lg border border-border bg-card text-left px-4 py-3.5 min-h-[7.5rem] hover:shadow-md hover:border-accent transition-all";

// Text block under a cover image: title + subtitle + fields as muted rows.
// Cover cards stay compact and low-key so the image leads.
const CoverCardText = ({ card }: { card: GridCardData }) => (
  <div className="flex flex-col gap-0.5 px-3 py-2">
    <div className="text-sm font-medium truncate">{card.title}</div>
    {card.subtitle && <div className="text-xs text-muted-foreground truncate">{card.subtitle}</div>}
    {card.fields.map((field, index) => (
      <div key={index} className={cn("truncate", index === 0 ? "text-sm font-semibold" : "text-xs text-muted-foreground")}>
        {field.value}
      </div>
    ))}
  </div>
);

const CoverCardBody = ({ card }: { card: GridCardData }) => (
  <>
    <div className="w-full aspect-[2/1] bg-muted overflow-hidden">
      {card.cover && <img src={card.cover} alt="" loading="lazy" className="w-full h-full object-cover" />}
    </div>
    <CoverCardText card={card} />
  </>
);

// No-cover card: its own type-driven layout, distinct from cover cards. The
// title is larger (it carries the card, with no image to lead), a lead value
// stands out, secondary fields collapse into subtle chips, and any trailing
// field sits pinned at the bottom as a muted footer.
const TextCardBody = ({ card }: { card: GridCardData }) => {
  const { rows, footer } = textCardSlots(card);
  return (
    <>
      <div className="text-lg font-semibold leading-snug tracking-tight line-clamp-2">{card.title}</div>
      {card.subtitle && <div className="mt-0.5 text-xs text-muted-foreground truncate">{card.subtitle}</div>}
      {rows.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {rows.map((row, rowIndex) => (
            // 50/50 split: left value left-aligned, right value right-aligned. The
            // first row's left cell is the emphasized "price" value.
            <div key={rowIndex} className="grid grid-cols-2 gap-2 items-baseline">
              <span
                className={cn(
                  "truncate",
                  rowIndex === 0 ? "text-base font-bold tracking-tight tabular-nums" : "text-sm text-muted-foreground",
                )}
              >
                {row.left?.value ?? ""}
              </span>
              {row.right && <span className="truncate text-right text-sm text-muted-foreground tabular-nums">{row.right.value}</span>}
            </div>
          ))}
        </div>
      )}
      {footer && <div className="mt-auto pt-2 text-[11px] text-muted-foreground truncate text-right tabular-nums">{footer.value}</div>}
    </>
  );
};

// Two-line strip: only the title and subtitle, never a cover. Its own compact
// design (small title), deliberately not shared with the no-cover text card.
const LongbarBody = ({ card }: { card: GridCardData }) => (
  <>
    <div className="text-sm font-medium truncate">{card.title}</div>
    <div className="text-xs text-muted-foreground truncate">{card.subtitle ?? " "}</div>
  </>
);

export const GridCard = ({ card, nocover, longbar }: GridCardProps) => {
  // Three distinct layouts: longbar strip, no-cover text card, cover card.
  const kind = gridCardKind(card, !!longbar, !!nocover);
  const containerClass = kind === "longbar" ? LONGBAR_CLASS : kind === "text" ? TEXT_CARD_CLASS : CARD_CLASS;
  const body =
    kind === "longbar" ? <LongbarBody card={card} /> : kind === "text" ? <TextCardBody card={card} /> : <CoverCardBody card={card} />;

  return (
    <GridCardLink url={card.url} className={containerClass} linkedClassName={LINKED_CARD_CLASS}>
      {body}
    </GridCardLink>
  );
};
