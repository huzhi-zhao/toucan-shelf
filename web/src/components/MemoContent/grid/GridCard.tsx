import { isRelativeDocHref, useDocumentLinkContext } from "@/components/MemoContent/DocumentLinkContext";
import { cn } from "@/lib/utils";
import type { GridCardData } from "./parseGridBlock";

interface GridCardProps {
  card: GridCardData;
}

const CARD_CLASS = "relative flex flex-col rounded-lg border border-border overflow-hidden bg-card text-left";
const LINKED_CARD_CLASS = "hover:shadow-md hover:border-accent transition-all cursor-pointer";

const CardBody = ({ card }: { card: GridCardData }) => (
  <>
    <div className="w-full aspect-[2/1] bg-muted overflow-hidden">
      {card.cover && <img src={card.cover} alt="" loading="lazy" className="w-full h-full object-cover" />}
    </div>
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <div className="text-sm font-medium truncate">{card.title}</div>
      {card.subtitle && <div className="text-xs text-muted-foreground truncate">{card.subtitle}</div>}
    </div>
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

export const GridCard = ({ card }: GridCardProps) => {
  const docLinkContext = useDocumentLinkContext();
  const { url } = card;

  if (!url) {
    return (
      <div className={CARD_CLASS}>
        <CardBody card={card} />
      </div>
    );
  }

  if (url.startsWith("#")) {
    return (
      <a href={url} className={cn(CARD_CLASS, LINKED_CARD_CLASS)} onClick={(e) => handleAnchorClick(e, url)}>
        <CardBody card={card} />
      </a>
    );
  }

  if (docLinkContext && isRelativeDocHref(url)) {
    const target = docLinkContext.resolve(url);
    if (target) {
      return (
        <a
          href={`/${target}`}
          className={cn(CARD_CLASS, LINKED_CARD_CLASS)}
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            docLinkContext.navigate(target, url);
          }}
        >
          <CardBody card={card} />
        </a>
      );
    }
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(CARD_CLASS, LINKED_CARD_CLASS)}>
      <CardBody card={card} />
    </a>
  );
};
