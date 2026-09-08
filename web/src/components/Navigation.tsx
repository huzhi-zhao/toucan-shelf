import { NavLink, useLocation } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import useCurrentUser from "@/hooks/useCurrentUser";
import useNotebookSidebarCollapsed from "@/hooks/useNotebookSidebarCollapsed";
import { useOpenLastDocument } from "@/hooks/useOpenLastDocument";
import usePrimaryNavLinks from "@/hooks/usePrimaryNavLinks";
import useSidebarMode from "@/hooks/useSidebarMode";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { isNotebookRoute } from "@/router/notebookRoute";
import { useTranslate } from "@/utils/i18n";
import { toggleNotebookSidebarCollapsed } from "@/utils/notebookSidebar";
import MemosLogo from "./MemosLogo";
import UserMenu from "./UserMenu";

interface Props {
  collapsed?: boolean;
  className?: string;
}

const Navigation = (props: Props) => {
  const { collapsed, className } = props;
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const location = useLocation();
  // On a Notebook route the logo doubles as the secondary sidebar's collapse/expand toggle;
  // everywhere else it takes the user back into the document they were last reading.
  const isNotebook = isNotebookRoute(location.pathname);
  const openLastDocument = useOpenLastDocument();
  const notebookSidebarCollapsed = useNotebookSidebarCollapsed();
  const sidebarMode = useSidebarMode();
  const isMini = sidebarMode === "mini";
  const iconSizeClass = isMini ? "size-4 shrink-0" : "size-5 shrink-0";
  const { primaryNavLinks, inboxAriaLabel } = usePrimaryNavLinks(iconSizeClass, isMini);

  return (
    <header className={cn("flex h-full w-full flex-col items-start justify-between gap-4 overflow-hidden", className)}>
      <div className="flex w-full shrink flex-col items-start justify-start gap-1.5 overflow-y-auto overflow-x-hidden p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isNotebook ? (
          <button
            type="button"
            className={cn(
              "mb-4 flex w-full cursor-pointer items-center rounded-xl px-1.5 outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
              isMini ? "h-9" : "h-11",
            )}
            onClick={toggleNotebookSidebarCollapsed}
            title={t(notebookSidebarCollapsed ? "notebook.expand-sidebar" : "notebook.collapse-sidebar")}
          >
            <MemosLogo collapsed={collapsed} mini={isMini} />
          </button>
        ) : currentUser ? (
          <button
            type="button"
            className={cn(
              "mb-4 flex w-full cursor-pointer items-center rounded-xl px-1.5 outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
              isMini ? "h-9" : "h-11",
            )}
            onClick={openLastDocument}
            title={t("notebook.open-last-document")}
          >
            <MemosLogo collapsed={collapsed} mini={isMini} />
          </button>
        ) : (
          <NavLink className="mb-4 flex w-full items-center rounded-xl px-1.5" to={Routes.EXPLORE}>
            <MemosLogo collapsed={collapsed} mini={isMini} />
          </NavLink>
        )}
        <TooltipProvider>
          {primaryNavLinks.map((navLink) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "relative flex w-full flex-row items-center overflow-hidden rounded-xl border text-sidebar-foreground outline-none",
                  "transition-[background-color,color,border-color,box-shadow,transform] duration-200",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
                  isMini ? "h-9 px-2 text-xs" : "h-11 px-2.5 text-sm",
                  isActive
                    ? "border-sidebar-foreground/10 bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "border-transparent opacity-75 hover:translate-x-0.5 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground hover:opacity-100",
                )
              }
              key={navLink.id}
              to={navLink.path}
              end={navLink.path === Routes.HOME}
              id={navLink.id}
              aria-label={collapsed ? (navLink.id === "header-inbox" ? inboxAriaLabel : navLink.title) : undefined}
              viewTransition
            >
              {props.collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>{navLink.icon}</div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{navLink.title}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                navLink.icon
              )}
              {!props.collapsed && (
                <span className={cn("truncate whitespace-nowrap font-medium", isMini ? "ml-2.5" : "ml-3")}>{navLink.title}</span>
              )}
            </NavLink>
          ))}
        </TooltipProvider>
      </div>
      {currentUser && (
        <div className="flex w-full flex-col justify-end border-t border-sidebar-foreground/10 pt-2">
          <UserMenu collapsed={collapsed} mini={isMini} />
        </div>
      )}
    </header>
  );
};

export default Navigation;
