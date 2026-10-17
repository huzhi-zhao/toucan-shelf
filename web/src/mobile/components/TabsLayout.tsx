import { Tabbar, TabbarLink } from "konsta/react";
import { LibraryBigIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { COPY } from "../copy";
import { MOBILE_ROUTES } from "../routes";

const TABS = [
  { path: MOBILE_ROUTES.SHELF, label: COPY.tabs.shelf, Icon: LibraryBigIcon },
  { path: MOBILE_ROUTES.SEARCH, label: COPY.tabs.search, Icon: SearchIcon },
  { path: MOBILE_ROUTES.ME, label: COPY.tabs.me, Icon: UserRoundIcon },
];

/** The three top-level pages share one bottom tab bar. Switching tabs replaces history rather than stacking it. */
export default function TabsLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <Outlet />
      {/* An opaque, blurred bar instead of Konsta's see-through fade: page text sliding under
          the tab labels was hard to read. */}
      <Tabbar
        labels
        icons
        className="mobile-tabbar left-0 bottom-0 fixed"
        colors={{ bgIos: "bg-[#f7f7f8]/92 dark:bg-[#161618]/92 backdrop-blur-xl border-t border-black/10 dark:border-white/10" }}
      >
        {TABS.map(({ path, label, Icon }) => (
          <TabbarLink
            key={path}
            active={pathname === path}
            onClick={() => pathname !== path && navigate(path, { replace: true })}
            icon={<Icon className="w-6 h-6" strokeWidth={1.8} />}
            label={label}
          />
        ))}
      </Tabbar>
    </>
  );
}
