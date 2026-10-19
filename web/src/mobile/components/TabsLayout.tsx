import { CalendarCheckIcon, LibraryBigIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { COPY } from "../copy";
import { noteTabHistory } from "../lib/nav";
import { MOBILE_ROUTES } from "../routes";

const TABS = [
  { path: MOBILE_ROUTES.PLAN, label: COPY.tabs.plan, Icon: CalendarCheckIcon },
  { path: MOBILE_ROUTES.SHELF, label: COPY.tabs.shelf, Icon: LibraryBigIcon },
  { path: MOBILE_ROUTES.SEARCH, label: COPY.tabs.search, Icon: SearchIcon },
  { path: MOBILE_ROUTES.ME, label: COPY.tabs.me, Icon: UserRoundIcon },
];

/**
 * The top-level pages share one bottom tab bar. Switching tabs replaces
 * history rather than stacking it.
 *
 * Drawn by hand rather than with Konsta's Tabbar: that one is the floating iOS 26
 * style, which pads the safe area with an extra 16px above and below and came out
 * far too tall — worst on the home-screen app, where the bottom inset is nonzero.
 * This is the classic 49pt bar; the home-indicator inset sits below it in the same
 * background, as in a native app.
 */
export default function TabsLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // The knowledge-base pages' "back to the shelf" button returns to this entry (useBackToShelf).
  useEffect(() => noteTabHistory(pathname === MOBILE_ROUTES.SHELF), [pathname]);
  return (
    <>
      <Outlet />
      <nav className="mobile-tabbar fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] bg-[#f9f9f9]/95 dark:bg-[#121214]/95 backdrop-blur-xl border-t border-black/10 dark:border-white/10">
        <div className="flex h-[49px] items-stretch">
          {TABS.map(({ path, label, Icon }) => {
            const active = pathname === path;
            return (
              <button
                key={path}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => !active && navigate(path, { replace: true })}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5 pt-1",
                  active ? "text-primary" : "text-black/55 dark:text-white/55",
                )}
              >
                <Icon className="w-6 h-6" strokeWidth={active ? 2.1 : 1.8} />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
