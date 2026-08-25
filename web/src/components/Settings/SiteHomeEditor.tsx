// Which `.blogview` document composes the site's front page.
//
// Choosing it here is also when its layout is frozen: a site home document is
// never published as a page — it has no slug and never appears in a listing —
// so this is the only moment its blocks are snapshotted. Re-saving the same document is how an
// author refreshes that snapshot after editing, the home page's equivalent of
// "update publication".
//
// The blocks that survive into the snapshot are decided on the server. The
// editor offers outward-facing blocks only, but the file is hand-editable and
// arrives through memogit as well: a knowledge-base block's folder paths and
// frontmatter rules would be ignored by the reader's renderer, and ignoring is
// not the same as not sending, so they are stripped before they are stored.

import { ConnectError } from "@connectrpc/connect";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOME_FOLDER_PATH } from "@/hooks/useHomeDocument";
import { useMemos } from "@/hooks/useMemoQueries";
import { useUpdateSite } from "@/hooks/useSiteQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Site } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";

/** The value the select uses for "no home page"; an empty string is not one. */
const NONE = "none";

const SiteHomeEditor = ({ site }: { site: Site }) => {
  const t = useTranslate();
  const updateSite = useUpdateSite();
  // Site home documents are few, so listing them all is cheaper than teaching
  // the memo filter grammar about folder paths. Ordinary `.view` documents are
  // deliberately absent: their blocks query the library, which a reader cannot
  // see, and the server refuses them here anyway.
  const { data, isLoading } = useMemos({ pageSize: 1000, state: State.NORMAL, filter: `doc_type == "BLOGVIEW"` });
  // The reserved Home document is each user's own dashboard, not a site page.
  const views = (data?.memos ?? []).filter((memo) => memo.folderPath !== HOME_FOLDER_PATH);

  const save = async (dashboard: string) => {
    try {
      await updateSite.mutateAsync({ site: { name: site.name, dashboard }, paths: ["dashboard"] });
      toast.success(t("setting.site.save-success"));
    } catch (e) {
      toast.error(e instanceof ConnectError ? e.message : t("setting.site.save-failed"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{t("setting.site.home")}</p>
      <p className="text-xs text-muted-foreground">{t("setting.site.home-description")}</p>
      <div className="flex items-center gap-2">
        <Select
          value={site.dashboard || NONE}
          disabled={isLoading || updateSite.isPending}
          onValueChange={(value) => void save(value === NONE ? "" : value)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder={t("setting.site.home-none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("setting.site.home-none")}</SelectItem>
            {views.map((memo) => (
              <SelectItem key={memo.name} value={memo.name}>
                {memo.title || memo.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {site.dashboard && (
          <Button variant="outline" size="sm" disabled={updateSite.isPending} onClick={() => void save(site.dashboard)}>
            {t("setting.site.home-refresh")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SiteHomeEditor;
