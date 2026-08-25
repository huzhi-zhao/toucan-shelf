// 站点首页面板。
//
// A `.blogview` has exactly one way out of the knowledge base: being chosen as
// some site's home page. That choice lives in the site settings — but a document
// whose only purpose is to be published needs to say so from the document, or
// the author is left looking at a page with no outward action on it at all.
//
// Choosing a site here is also what freezes the layout. There is no "publish"
// for a home page: no slug, no listing, no publication row — the snapshot is
// taken at the moment the site is pointed at this document, so re-saving the
// same choice is this type's "update publication". See
// docs/dev/design/20260823-public-publishing/front-end.md §5.

import { ConnectError } from "@connectrpc/connect";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSites, useUpdateSite } from "@/hooks/useSiteQueries";
import { publicSitePath } from "@/router/routes";
import type { Site } from "@/types/proto/api/v1/site_service_pb";
import { SiteStatus } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";

const errorMessage = (e: unknown, fallback: string) => (e instanceof ConnectError ? e.message : fallback);

const SiteRow = ({ site, memoName }: { site: Site; memoName: string }) => {
  const t = useTranslate();
  const updateSite = useUpdateSite();
  const isHome = site.dashboard === memoName;
  // Another document already holds the front door. Saying so before the click
  // matters: nothing warns afterwards, and the replaced layout is not recoverable
  // from here.
  const replacesAnother = !isHome && site.dashboard !== "";

  const save = async (dashboard: string, successKey: "memo.site-home.set" | "memo.site-home.refreshed" | "memo.site-home.cleared") => {
    try {
      await updateSite.mutateAsync({ site: { name: site.name, dashboard }, paths: ["dashboard"] });
      toast.success(t(successKey));
    } catch (e) {
      toast.error(errorMessage(e, t("memo.site-home.failed")));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{site.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {isHome ? t("memo.site-home.is-home") : replacesAnother ? t("memo.site-home.another-home") : t("memo.site-home.no-home")}
          </p>
        </div>
        {isHome && (
          <a
            href={publicSitePath(site.name)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="h-3 w-3" />
            {t("memo.site-home.open-site")}
          </a>
        )}
      </div>

      {site.status !== SiteStatus.ONLINE && <p className="text-xs text-muted-foreground">{t("memo.publish.site-not-online")}</p>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={updateSite.isPending}
          onClick={() => void save(memoName, isHome ? "memo.site-home.refreshed" : "memo.site-home.set")}
        >
          {updateSite.isPending && <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />}
          {isHome ? t("memo.site-home.refresh") : t("memo.site-home.set-as-home")}
        </Button>
        {isHome && (
          <Button variant="outline" size="sm" disabled={updateSite.isPending} onClick={() => void save("", "memo.site-home.cleared")}>
            {t("memo.site-home.clear")}
          </Button>
        )}
      </div>
    </div>
  );
};

interface Props {
  memoName: string;
  open: boolean;
  onClose: () => void;
}

const MemoSiteHomePanel = ({ memoName, open, onClose }: Props) => {
  const t = useTranslate();
  const { data: sites, isLoading } = useSites(open);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("memo.site-home.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("memo.site-home.description")}</p>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {isLoading ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !sites || sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("memo.publish.no-sites")}</p>
          ) : (
            sites.map((site) => <SiteRow key={site.name} site={site} memoName={memoName} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MemoSiteHomePanel;
