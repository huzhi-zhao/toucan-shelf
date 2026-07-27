import { BellIcon, HouseIcon, InfoIcon, LibraryBigIcon, PaperclipIcon, SearchIcon, UserCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { UserNotification_Status } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import useCurrentUser from "./useCurrentUser";
import { useNotifications } from "./useUserQueries";

export interface NavLinkItem {
  id: string;
  path: string;
  title: string;
  icon: React.ReactNode;
}

const usePrimaryNavLinks = (iconSizeClass: string, isMini = true) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { data: notifications = [] } = useNotifications();

  // The Home page: the user's own cross-knowledge-base entry points. Sits above
  // search as the first thing in the sidebar.
  const dashboardNavLink: NavLinkItem = {
    id: "header-dashboard",
    path: Routes.DASHBOARD,
    title: t("home.title"),
    icon: <HouseIcon className={iconSizeClass} />,
  };
  const shelfNavLink: NavLinkItem = {
    id: "header-shelf",
    path: Routes.SHELF,
    title: t("bookshelf.title"),
    icon: <LibraryBigIcon className={iconSizeClass} />,
  };
  // Explore is now the unified search + browse surface (relevance-ranked keyword search
  // over all visible documents, with structured filters), so it carries the search icon.
  const exploreNavLink: NavLinkItem = {
    id: "header-explore",
    path: Routes.EXPLORE,
    title: t("common.explore"),
    icon: <SearchIcon className={iconSizeClass} />,
  };
  const aboutNavLink: NavLinkItem = {
    id: "header-about",
    path: Routes.ABOUT,
    title: t("common.about"),
    icon: <InfoIcon className={iconSizeClass} />,
  };
  const attachmentsNavLink: NavLinkItem = {
    id: "header-attachments",
    path: Routes.ATTACHMENTS,
    title: t("common.attachments"),
    icon: <PaperclipIcon className={iconSizeClass} />,
  };
  const unreadCount = notifications.filter((n) => n.status === UserNotification_Status.UNREAD).length;
  const inboxNavLink: NavLinkItem = {
    id: "header-inbox",
    path: Routes.INBOX,
    title: t("common.inbox"),
    icon: (
      <div className="relative">
        <BellIcon className={iconSizeClass} />
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 flex items-center justify-center bg-primary text-primary-foreground font-semibold rounded-full border-2 border-background",
              isMini ? "min-w-[14px] h-[14px] px-0.5 text-[8px]" : "min-w-[18px] h-[18px] px-1 text-[10px]",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
    ),
  };
  const signInNavLink: NavLinkItem = {
    id: "header-auth",
    path: Routes.AUTH,
    title: t("common.sign-in"),
    icon: <UserCircleIcon className={iconSizeClass} />,
  };

  const primaryNavLinks: NavLinkItem[] = currentUser
    ? [dashboardNavLink, exploreNavLink, shelfNavLink, attachmentsNavLink, inboxNavLink]
    : [exploreNavLink, aboutNavLink, signInNavLink];
  const inboxAriaLabel = unreadCount > 0 ? `${t("common.inbox")}, ${unreadCount} unread` : t("common.inbox");

  return { primaryNavLinks, inboxAriaLabel };
};

export default usePrimaryNavLinks;
