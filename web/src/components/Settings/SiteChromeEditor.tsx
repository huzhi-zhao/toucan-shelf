// The site's chrome: its top menu and its theme.
//
// Both are site configuration rather than part of the home `.view` document,
// because both render on every outward-facing page — article, search, contents —
// and none of those pages loads that document.
//
// The theme is a fixed set of named values, never a stylesheet. The list here is
// only the form; the check that actually keeps arbitrary CSS out of a page served
// to anonymous readers is on the server, because a request can skip this form.

import { ConnectError } from "@connectrpc/connect";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateSite } from "@/hooks/useSiteQueries";
import type { Site } from "@/types/proto/api/v1/site_service_pb";
import { useTranslate } from "@/utils/i18n";

/** The theme keys, grouped the way an author thinks about them. */
const THEME_FIELDS: { key: string; placeholder: string }[] = [
  { key: "bg", placeholder: "#ffffff" },
  { key: "surface", placeholder: "#f3f4f6" },
  { key: "ink", placeholder: "#17181a" },
  { key: "ink-soft", placeholder: "#43474d" },
  { key: "ink-muted", placeholder: "#6c7178" },
  { key: "hairline", placeholder: "#e4e5e8" },
  { key: "accent", placeholder: "#1b4fa8" },
  { key: "accent-soft", placeholder: "#e0e9fa" },
  { key: "font-display", placeholder: "Avenir Next, sans-serif" },
  { key: "font-body", placeholder: "Segoe UI, sans-serif" },
  { key: "cover-radius", placeholder: "24px" },
  { key: "shell-max", placeholder: "1440px" },
  { key: "gutter", placeholder: "40px" },
  { key: "prose-max", placeholder: "46rem" },
];

const parseTheme = (theme: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(theme || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  } catch {
    return {};
  }
};

interface MenuRow {
  label: string;
  path: string;
}

const SiteChromeEditor = ({ site }: { site: Site }) => {
  const t = useTranslate();
  const updateSite = useUpdateSite();
  const [menu, setMenu] = useState<MenuRow[]>(site.menu.map((item) => ({ label: item.label, path: item.path })));
  const [theme, setTheme] = useState<Record<string, string>>(parseTheme(site.theme));

  const save = async (paths: string[]) => {
    try {
      await updateSite.mutateAsync({
        site: {
          name: site.name,
          menu: menu.map((row) => ({ label: row.label.trim(), path: row.path.trim() })),
          // Only the values the author actually set are stored; a blank field
          // means "use the skin's default", not "the empty string".
          theme: JSON.stringify(Object.fromEntries(Object.entries(theme).filter(([, value]) => value.trim() !== ""))),
        },
        paths,
      });
      toast.success(t("setting.site.save-success"));
    } catch (e) {
      toast.error(e instanceof ConnectError ? e.message : t("setting.site.save-failed"));
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{t("setting.site.menu")}</p>
        <p className="text-xs text-muted-foreground">{t("setting.site.menu-description")}</p>
        {menu.map((row, index) => (
          // The rows have no identity of their own — the menu is an ordered list,
          // and an entry is only ever "the nth one".
          <div key={index} className="flex items-center gap-2">
            <Input
              value={row.label}
              onChange={(e) => setMenu(menu.map((item, i) => (i === index ? { ...item, label: e.target.value } : item)))}
              placeholder={t("setting.site.menu-label")}
              className="h-8"
            />
            <Input
              value={row.path}
              onChange={(e) => setMenu(menu.map((item, i) => (i === index ? { ...item, path: e.target.value } : item)))}
              placeholder={t("setting.site.menu-path")}
              className="h-8 w-48 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" onClick={() => setMenu(menu.filter((_, i) => i !== index))}>
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMenu([...menu, { label: "", path: "" }])}>
            <PlusIcon className="mr-1 h-4 w-4" />
            {t("setting.site.menu-add")}
          </Button>
          <Button variant="outline" size="sm" disabled={updateSite.isPending} onClick={() => void save(["menu"])}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{t("setting.site.theme")}</p>
        <p className="text-xs text-muted-foreground">{t("setting.site.theme-description")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {THEME_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2">
              <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{field.key}</span>
              <Input
                value={theme[field.key] ?? ""}
                onChange={(e) => setTheme({ ...theme, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className="h-8 font-mono text-xs"
              />
            </label>
          ))}
        </div>
        <Button variant="outline" size="sm" className="self-start" disabled={updateSite.isPending} onClick={() => void save(["theme"])}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};

export default SiteChromeEditor;
