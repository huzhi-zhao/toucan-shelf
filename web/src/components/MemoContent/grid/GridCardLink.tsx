import type { ReactNode } from "react";
import { classifyDocHref, useDocumentLinkContext } from "@/components/MemoContent/DocumentLinkContext";
import { cn } from "@/lib/utils";

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

interface GridCardLinkProps {
  /** The card's `url`; without one the card is a plain box. */
  url?: string;
  className?: string;
  /** Added when the card is a link. */
  linkedClassName?: string;
  children: ReactNode;
}

/**
 * Wraps a grid card in what its `url` points at: an in-page anchor scrolls there,
 * an in-workspace document path opens that document through the surface's
 * document-link context, anything else opens in a new tab. Shared by the web grid
 * and the mobile reader's preview (mobile-phase3.md §4), each with its own look.
 */
export const GridCardLink = ({ url, className, linkedClassName, children }: GridCardLinkProps) => {
  const docLinkContext = useDocumentLinkContext();

  if (!url) {
    return <div className={className}>{children}</div>;
  }

  if (url.startsWith("#")) {
    return (
      <a href={url} className={cn(className, linkedClassName)} onClick={(e) => handleAnchorClick(e, url)}>
        {children}
      </a>
    );
  }

  const form = classifyDocHref(url);
  if (docLinkContext && (form === "rootRelative" || form === "relativeExplicit" || form === "relativeBare")) {
    const target = docLinkContext.resolve(url);
    if (target) {
      return (
        <a
          href={`/${target}`}
          className={cn(className, linkedClassName)}
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            docLinkContext.navigate(target, url);
          }}
        >
          {children}
        </a>
      );
    }
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(className, linkedClassName)}>
      {children}
    </a>
  );
};
