import { isRootRelativeDocHref, useDocumentLinkContext } from "@/components/MemoContent/DocumentLinkContext";
import { cn } from "@/lib/utils";
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

// A no-cover text card fits within this many text rows (title + subtitle count
// toward it), keeping the wall of cards visually even.
const MAX_TEXT_CARD_ROWS = 6;

// Splits a card's extra fields into the slots of a text card: a trailing footer
// (date / note, pinned to the bottom, full width), and the remaining fields laid
// out two-per-row (a 50/50 split, left value + right value) starting at the lead
// "price" row. Rows are capped so the whole card stays within the 6-row budget.
function textCardSlots(card: GridCardData) {
  const fields = card.fields;
  // A trailing field becomes the footer only when there is a body field ahead of it.
  const footer = fields.length >= 2 ? fields[fields.length - 1] : undefined;
  const body = footer ? fields.slice(0, -1) : fields;

  // Row budget: title(1) + subtitle? + footer? leaves this many rows for body,
  // each row holding up to two fields.
  const used = 1 + (card.subtitle ? 1 : 0) + (footer ? 1 : 0);
  const rowBudget = Math.max(0, MAX_TEXT_CARD_ROWS - used);
  const visible = body.slice(0, rowBudget * 2);

  const rows: { left?: (typeof visible)[number]; right?: (typeof visible)[number] }[] = [];
  for (let i = 0; i < visible.length; i += 2) {
    rows.push({ left: visible[i], right: visible[i + 1] });
  }

  return { rows, footer };
}

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

// Scrolls to an in-page heading/anchor, scoped to the enclosing memo's own content
// container so duplicate ids elsewhere on the page can't steal the scroll. Mirrors
// the fallback branch of MemoContent/markdown/AnchorLink.tsx.
const handleAnchorClick = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  const id = decodeURIComponent(href.slice(1));
  if (!id) return;
  const root = event.currentTarget.closest("[data-memo-content]");
  const target = root?.querySelector(`#${CSS.escape(id)}`);
  if (target) {
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

export const GridCard = ({ card, nocover, longbar }: GridCardProps) => {
  const docLinkContext = useDocumentLinkContext();
  const { url } = card;

  const hideCover = longbar || nocover || card.nocover;
  // Three distinct layouts: longbar strip, no-cover text card, cover card.
  const containerClass = longbar ? LONGBAR_CLASS : hideCover ? TEXT_CARD_CLASS : CARD_CLASS;
  const body = longbar ? <LongbarBody card={card} /> : hideCover ? <TextCardBody card={card} /> : <CoverCardBody card={card} />;

  if (!url) {
    return <div className={containerClass}>{body}</div>;
  }

  if (url.startsWith("#")) {
    return (
      <a href={url} className={cn(containerClass, LINKED_CARD_CLASS)} onClick={(e) => handleAnchorClick(e, url)}>
        {body}
      </a>
    );
  }

  if (docLinkContext && isRootRelativeDocHref(url)) {
    const target = docLinkContext.resolve(url);
    if (target) {
      return (
        <a
          href={`/${target}`}
          className={cn(containerClass, LINKED_CARD_CLASS)}
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            docLinkContext.navigate(target, url);
          }}
        >
          {body}
        </a>
      );
    }
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(containerClass, LINKED_CARD_CLASS)}>
      {body}
    </a>
  );
};
