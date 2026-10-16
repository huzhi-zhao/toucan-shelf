import { GlobeIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLinkMetadata } from "@/hooks/useMemoQueries";
import { useTranslate } from "@/utils/i18n";
import type { UrlReference } from "@/utils/urlReferences";

interface Props {
  reference: UrlReference;
  /** Offered in the editor only; the preview's References section is read-only. */
  onEdit?: () => void;
  onRemove?: () => void;
}

function siteOf(url: string): { hostname: string; favicon: string } {
  try {
    const parsed = new URL(url);
    return { hostname: parsed.hostname.replace(/^www\./, ""), favicon: `${parsed.origin}/favicon.ico` };
  } catch {
    return { hostname: url, favicon: "" };
  }
}

/**
 * One external link in the References section. It sits next to the sub-document
 * cards because it matters as much, but it is a different thing — a page outside
 * this system — so it looks different: the site's icon and host instead of a
 * document icon, and the author's note on when to open it instead of a body
 * preview.
 *
 * Many of these links are private (a Google Doc the server is not signed in to),
 * so the metadata fetch often yields no title. The card still renders, titled by
 * the host and marked by the site's own favicon: a link that matters this much
 * must never degrade into a bare URL.
 */
export const UrlReferenceCard = ({ reference, onEdit, onRemove }: Props) => {
  const t = useTranslate();
  const { data: metadata } = useLinkMetadata(reference.url);
  const site = siteOf(reference.url);
  const favicon = metadata?.favicon || site.favicon;
  const [faviconFailed, setFaviconFailed] = useState(false);
  useEffect(() => setFaviconFailed(false), [favicon]);

  const title = metadata?.title.trim() || site.hostname;

  // The card itself is a link; its buttons must not also open it.
  const act = (action: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background/65 px-3 py-2.5 transition-colors hover:bg-accent/20"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
        {favicon && !faviconFailed ? (
          <img src={favicon} alt="" className="h-5 w-5 object-contain" loading="lazy" onError={() => setFaviconFailed(true)} />
        ) : (
          <GlobeIcon className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium leading-tight text-foreground" title={title}>
            {title}
          </span>
          {title !== site.hostname && <span className="shrink-0 truncate text-xs text-muted-foreground">{site.hostname}</span>}
        </div>
        {reference.note && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={reference.note}>
            {reference.note}
          </div>
        )}
      </div>
      {(onEdit || onRemove) && (
        <div className="ml-auto flex shrink-0 items-center">
          {onEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={act(onEdit)}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("subdoc.edit-link")}</TooltipContent>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                  onClick={act(onRemove)}
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("subdoc.remove-link")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </a>
  );
};

export default UrlReferenceCard;
