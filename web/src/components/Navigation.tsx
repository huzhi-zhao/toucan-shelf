import { NavLink, useLocation } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import useCurrentUser from "@/hooks/useCurrentUser";
import useNotebookSidebarCollapsed from "@/hooks/useNotebookSidebarCollapsed";
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
  // Every Notebook route (not just "/") owns the secondary sidebar, so the logo doubles as its toggle there.
  const isNotebook = isNotebookRoute(location.pathname);
  const notebookSidebarCollapsed = useNotebookSidebarCollapsed();
  const sidebarMode = useSidebarMode();
  const isMini = sidebarMode === "mini";
  const iconSizeClass = isMini ? "w-4 h-auto shrink-0" : "w-6 h-auto shrink-0";
  const { primaryNavLinks, inboxAriaLabel } = usePrimaryNavLinks(iconSizeClass, isMini);

  return (
    <header className={cn("w-full h-full overflow-auto flex flex-col justify-between items-start gap-4", className)}>
      <div className="w-full px-1 py-1 flex flex-col justify-start items-start space-y-2 overflow-auto overflow-x-hidden shrink">
        {isNotebook ? (
          <button
            type="button"
            className="mb-3 cursor-pointer"
            onClick={toggleNotebookSidebarCollapsed}
            title={t(notebookSidebarCollapsed ? "notebook.expand-sidebar" : "notebook.collapse-sidebar")}
          >
            <MemosLogo collapsed={collapsed} mini={isMini} />
          </button>
        ) : (
          <NavLink className="mb-3 cursor-default" to={currentUser ? Routes.HOME : Routes.EXPLORE}>
            <MemosLogo collapsed={collapsed} mini={isMini} />
          </NavLink>
        )}
        <TooltipProvider>
          {primaryNavLinks.map((navLink) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "rounded-2xl border flex flex-row items-center text-sidebar-foreground transition-colors",
                  isMini ? "px-1.5 py-1.5 text-xs" : "px-2 py-2 text-lg",
                  collapsed ? "" : cn("w-full", isMini ? "px-2" : "px-4"),
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-accent-border drop-shadow"
                    : "border-transparent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:border-sidebar-accent-border opacity-80",
                )
              }
              key={navLink.id}
              to={navLink.path}
              end={navLink.path === Routes.HOME}
              id={navLink.id}
              aria-label={navLink.id === "header-inbox" ? inboxAriaLabel : undefined}
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
              {!props.collapsed && <span className={cn("truncate", isMini ? "ml-2" : "ml-3")}>{navLink.title}</span>}
            </NavLink>
          ))}
        </TooltipProvider>
      </div>
      {currentUser && (
        <div className={cn("w-full flex flex-col justify-end", props.collapsed ? "items-center" : "items-start pl-3")}>
          <UserMenu collapsed={collapsed} mini={isMini} />
        </div>
      )}
    </header>
  );
};

export default Navigation;
