import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { useInstance } from "@/contexts/InstanceContext";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import useSidebarMode from "@/hooks/useSidebarMode";
import { cn } from "@/lib/utils";
import { buildAuthRoute, shouldGatePrivateInstance } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";

const MEMOS_DEPLOY_URL = "https://usememos.com/docs/deploy";

const DemoBanner = () => {
  const t = useTranslate();

  return (
    <div className="static w-full border-b border-border bg-muted/70 px-4 py-2 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-center sm:gap-2">
        <span className="font-medium text-foreground">{t("demo.banner-title")}</span>
        <span>{t("demo.banner-description")}</span>
        <a className="font-medium text-primary underline-offset-4 hover:underline" href={MEMOS_DEPLOY_URL} target="_blank" rel="noreferrer">
          {t("demo.deploy-link")}
        </a>
      </div>
    </div>
  );
};

const RootLayout = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sm = useMediaQuery("sm");
  const sidebarMode = useSidebarMode();
  const isMini = sidebarMode === "mini";
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { profile } = useInstance();
  const currentUser = useCurrentUser();
  const showSidebar = sm && !!currentUser;
  const { removeFilter } = useMemoFilterContext();
  const { pathname } = location;
  const prevPathnameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prevPathname = prevPathnameRef.current;

    // When the route changes and there is no filter in the search params, remove all filters.
    if (prevPathname !== undefined && prevPathname !== pathname && !searchParams.has("filter")) {
      removeFilter(() => true);
    }

    prevPathnameRef.current = pathname;
  }, [pathname, searchParams, removeFilter]);

  // Private instance (no InstanceURL configured): anonymous visitors may only reach
  // share links; everything else redirects to the sign-in page, preserving the intended
  // destination. Public instances keep the open Explore behavior for logged-out users.
  if (shouldGatePrivateInstance({ isPrivateInstance: !profile.instanceUrl, isAuthenticated: !!currentUser, pathname })) {
    const redirect = `${pathname}${location.search}${location.hash}`;
    return <Navigate to={buildAuthRoute({ redirect })} replace />;
  }

  return (
    <div className={cn("min-h-full w-full", showSidebar ? "bg-sidebar" : "bg-background")}>
      {showSidebar && (
        <div
          className={cn(
            "group fixed inset-y-0 left-0 z-0 flex select-none flex-col overflow-hidden bg-sidebar",
            "transition-[width] duration-300 ease-out motion-reduce:transition-none",
            sidebarExpanded ? (isMini ? "w-52" : "w-60") : isMini ? "w-12" : "w-[3.75rem]",
            isMini ? "p-1.5" : "p-2",
          )}
          onMouseEnter={() => setSidebarExpanded(true)}
          onMouseLeave={() => setSidebarExpanded(false)}
          onFocusCapture={() => setSidebarExpanded(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSidebarExpanded(false);
          }}
        >
          <Navigation className={isMini ? "py-1" : "py-2"} collapsed={!sidebarExpanded} />
        </div>
      )}
      <main
        className={cn(
          "relative z-10 flex min-h-screen min-w-0 flex-col items-center justify-start bg-background",
          showSidebar && [
            "rounded-l-[1.75rem] border-l border-border/80 shadow-xl",
            "transition-[margin-left] duration-300 ease-out motion-reduce:transition-none",
            sidebarExpanded ? (isMini ? "ml-52" : "ml-60") : isMini ? "ml-12" : "ml-[3.75rem]",
          ],
        )}
      >
        {profile.demo && <DemoBanner />}
        <Outlet />
      </main>
    </div>
  );
};

export default RootLayout;
