import { useEffect, useMemo, useState } from "react";
import { matchPath, Outlet, useLocation } from "react-router-dom";
import type { MemoExplorerContext } from "@/components/MemoExplorer";
import { MemoExplorer, MemoExplorerDrawer } from "@/components/MemoExplorer";
import MobileHeader from "@/components/MobileHeader";
import { userServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useFilteredMemoStats } from "@/hooks/useFilteredMemoStats";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { isNotebookRoute } from "@/router/notebookRoute";

const PROFILE_ROUTE = "/u/:username";
const DESKTOP_EXPLORER_WIDTH_CLASS = "w-64";
const DESKTOP_EXPLORER_CLASS_NAME = cn("sticky top-0 h-svh shrink-0 border-r border-border transition-all", DESKTOP_EXPLORER_WIDTH_CLASS);
const MAIN_CONTENT_CLASS_NAME = "w-full min-h-full min-w-0 flex-1";

const MainLayout = () => {
  const md = useMediaQuery("md");
  const location = useLocation();
  const currentUser = useCurrentUser();
  const [profileUserName, setProfileUserName] = useState<string | undefined>();
  // The Notebook page ("/:workspaceTitle" and "/:workspaceTitle/:docId") owns its own
  // secondary sidebar (workspace tree) and full-bleed two-pane layout, so it also opts
  // out of the horizontal padding the other pages get.
  const isNotebook = isNotebookRoute(location.pathname);
  // The Home page ("/dashboard", plus its "/dashboard/:sectionId" tabs) spans the full
  // width the same way.
  const isDashboard = location.pathname === Routes.DASHBOARD || location.pathname.startsWith(`${Routes.DASHBOARD}/`);

  // Which routes get the MemoExplorer (search + calendar + tag filters) sidebar.
  //
  // This is deliberately an allow-list, not a deny-list: the MemoExplorer only makes
  // sense on the pages that render the filterable *memo feed*, so a page that isn't
  // listed here gets no secondary sidebar. Adding a new page therefore requires no
  // change to this file — the previous deny-list meant every new page silently
  // inherited a calendar it had no use for until someone remembered to opt out.
  const context: MemoExplorerContext | null = useMemo(() => {
    if (location.pathname === Routes.HOME || location.pathname === Routes.SHORTCUTS) return "home";
    if (location.pathname === Routes.EXPLORE) return "explore";
    if (location.pathname === Routes.ARCHIVED) return "archived";
    if (matchPath(PROFILE_ROUTE, location.pathname)) return "profile";
    return null;
  }, [location.pathname]);
  const showMemoExplorer = context !== null;

  // Extract username from URL for profile context
  useEffect(() => {
    const match = matchPath(PROFILE_ROUTE, location.pathname);
    if (match && context === "profile") {
      const username = match.params.username;
      if (username) {
        // Fetch or get user to obtain the canonical user name (e.g., "users/steven")
        // Note: User stats will be fetched by useFilteredMemoStats
        userServiceClient
          .getUser({ name: `users/${username}` })
          .then((user) => {
            setProfileUserName(user.name);
          })
          .catch((error) => {
            console.error("Failed to fetch profile user:", error);
            setProfileUserName(undefined);
          });
      }
    } else {
      setProfileUserName(undefined);
    }
  }, [location.pathname, context]);

  // Determine which user name to use for per-user stats.
  // - home: current user's stats
  // - profile: viewed user's stats
  // - archived/explore: no user scope (each handled differently inside the hook)
  const statsUserName = useMemo(() => {
    if (context === "home") return currentUser?.name;
    if (context === "profile") return profileUserName;
    return undefined;
  }, [context, currentUser, profileUserName]);

  const { statistics, tags } = useFilteredMemoStats({
    userName: statsUserName,
    context: context ?? undefined,
  });
  const memoExplorerProps = {
    context: context ?? "home",
    statisticsData: statistics,
    tagCount: tags,
  };

  return (
    <section className="@container w-full min-h-full flex flex-col justify-start items-center md:flex-row md:items-start">
      {!md && <MobileHeader>{showMemoExplorer && <MemoExplorerDrawer {...memoExplorerProps} />}</MobileHeader>}
      {md && showMemoExplorer && (
        <div className={DESKTOP_EXPLORER_CLASS_NAME}>
          <MemoExplorer className="px-3 py-3" {...memoExplorerProps} />
        </div>
      )}
      <div className={MAIN_CONTENT_CLASS_NAME}>
        {isNotebook || isDashboard ? (
          <Outlet />
        ) : (
          <div className={cn("w-full mx-auto px-4 sm:px-6 md:pt-6 pb-8")}>
            <Outlet />
          </div>
        )}
      </div>
    </section>
  );
};

export default MainLayout;
