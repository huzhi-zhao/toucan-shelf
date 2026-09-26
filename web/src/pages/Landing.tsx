import {
  BotIcon,
  FolderTreeIcon,
  GlobeIcon,
  LayoutGridIcon,
  type LucideIcon,
  PaperclipIcon,
  SearchIcon,
  TablePropertiesIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/contexts/InstanceContext";
import usePageTitle from "@/hooks/usePageTitle";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

// Only features that ship today. Copy lives under `landing.feature-*`; keep it
// to checkable facts — no "powerful"/"fast" adjectives.
type FeatureKey = "hierarchy" | "view-blocks" | "gallery" | "agents" | "search" | "publish" | "storage";

const FEATURES: { key: FeatureKey; icon: LucideIcon }[] = [
  { key: "hierarchy", icon: FolderTreeIcon },
  { key: "view-blocks", icon: TablePropertiesIcon },
  { key: "gallery", icon: LayoutGridIcon },
  { key: "agents", icon: BotIcon },
  { key: "search", icon: SearchIcon },
  { key: "publish", icon: GlobeIcon },
  { key: "storage", icon: PaperclipIcon },
];

/**
 * What an anonymous visitor sees at `/`: a short introduction to the product with
 * a sign-in entry in the top-right corner. Rendered by RootLayout in place of the
 * app chrome; every other guest URL still goes through the normal auth redirect.
 */
const Landing = () => {
  const t = useTranslate();
  const { generalSetting } = useInstance();
  const brand = generalSetting.customProfile?.title || "ToucanShelf";
  const logoUrl = generalSetting.customProfile?.logoUrl || "/logo.svg";
  usePageTitle();

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <img src={logoUrl} alt="" className="size-7 shrink-0 rounded-md" />
            <span className="truncate text-base font-semibold">{brand}</span>
          </div>
          <Button asChild size="sm">
            <Link to={ROUTES.AUTH}>{t("common.sign-in")}</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <span className="rounded-full border border-border px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("landing.eyebrow")}
          </span>
          <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            {t("landing.headline")}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">{t("landing.subhead")}</p>
          <Button asChild size="lg">
            <Link to={ROUTES.AUTH}>{t("landing.cta")}</Link>
          </Button>
        </section>

        <section className="border-t border-border/60 bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="mb-8 text-sm font-medium tracking-wide text-muted-foreground uppercase">{t("landing.features-title")}</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ key, icon: Icon }, index) => (
                <li key={key} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-primary" aria-hidden />
                    <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <h3 className="text-base font-semibold">{t(`landing.feature-${key}-title`)}</h3>
                  <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{t(`landing.feature-${key}-body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground sm:px-6">{t("landing.footer")}</footer>
    </div>
  );
};

export default Landing;
