// The site's navigation tree, edited as an indented list.
//
// The tree is authored here rather than derived from where the source documents
// live: a published page's URL is flat, and a site may draw from several
// knowledge bases that share no folder structure. Nesting is navigation only —
// moving an entry under another one never changes the page's address.
//
// A row points at a page by slug. Entries whose slug is not published are still
// kept here, because the author is often building the tree ahead of publishing;
// the server drops them from what readers are served rather than showing a dead
// link.

import { ConnectError } from "@connectrpc/connect";
import { IndentIncreaseIcon, OutdentIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateSite } from "@/hooks/useSiteQueries";
import type { Site } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";
import { flattenNav, MAX_DEPTH, type NavRow, nestNav } from "./siteNav";

const SiteNavEditor = ({ site }: { site: Site }) => {
  const t = useTranslate();
  const updateSite = useUpdateSite();
  const [rows, setRows] = useState<NavRow[]>(flattenNav(site.nav));

  const patch = (index: number, change: Partial<NavRow>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const save = async () => {
    try {
      await updateSite.mutateAsync({
        site: { name: site.name, nav: nestNav(rows.filter((row) => row.label.trim() !== "")) },
        paths: ["nav"],
      });
      toast.success(t("setting.site.save-success"));
    } catch (e) {
      toast.error(e instanceof ConnectError ? e.message : t("setting.site.save-failed"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{t("setting.site.nav")}</p>
      <p className="text-xs text-muted-foreground">{t("setting.site.nav-description")}</p>
      {rows.map((row, index) => (
        // The rows have no identity of their own — the tree is an ordered list,
        // and a row is only ever "the nth one".
        <div key={index} className="flex items-center gap-2" style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
          <Input
            value={row.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder={t("setting.site.nav-label")}
            className="h-8"
          />
          <Input
            value={row.slug}
            onChange={(e) => patch(index, { slug: e.target.value })}
            placeholder={t("setting.site.nav-slug")}
            className="h-8 w-48 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={row.depth === 0}
            title={t("setting.site.nav-outdent")}
            onClick={() => patch(index, { depth: row.depth - 1 })}
          >
            <OutdentIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            // Indenting the first row, or more than one level past the row above,
            // would describe a parent that is not there.
            disabled={index === 0 || row.depth >= Math.min(rows[index - 1].depth + 1, MAX_DEPTH)}
            title={t("setting.site.nav-indent")}
            onClick={() => patch(index, { depth: row.depth + 1 })}
          >
            <IndentIncreaseIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { depth: 0, label: "", slug: "" }])}>
          <PlusIcon className="mr-1 h-4 w-4" />
          {t("setting.site.nav-add")}
        </Button>
        <Button variant="outline" size="sm" disabled={updateSite.isPending} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};

export default SiteNavEditor;
