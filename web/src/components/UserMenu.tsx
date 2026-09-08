import {
  ArchiveIcon,
  CheckIcon,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  PaletteIcon,
  SettingsIcon,
  SquareUserIcon,
  User2Icon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useSSEConnectionStatus } from "@/hooks/useLiveMemoRefresh";
import useNavigateTo from "@/hooks/useNavigateTo";
import { useUpdateUserGeneralSetting } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { getLocaleWithFallback, loadLocale, useTranslate } from "@/utils/i18n";
import { getThemeWithFallback, loadTheme, THEME_OPTIONS } from "@/utils/theme";
import { LocaleSearchList } from "./LocalePicker";
import UserAvatar from "./UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props {
  collapsed?: boolean;
  mini?: boolean;
}

const UserMenu = (props: Props) => {
  const { collapsed, mini } = props;
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const currentUser = useCurrentUser();
  const { userGeneralSetting, refetchSettings, logout } = useAuth();
  const { mutate: updateUserGeneralSetting } = useUpdateUserGeneralSetting(currentUser?.name);
  const sseStatus = useSSEConnectionStatus();
  const currentLocale = getLocaleWithFallback(userGeneralSetting?.locale);
  const currentTheme = getThemeWithFallback(userGeneralSetting?.theme);

  const handleLocaleChange = async (locale: Locale) => {
    if (!currentUser) return;
    // Apply locale immediately for instant UI feedback and persist to localStorage
    loadLocale(locale);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { locale }, updateMask: ["locale"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleThemeChange = async (theme: string) => {
    if (!currentUser) return;
    // Apply theme immediately for instant UI feedback
    loadTheme(theme);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { theme }, updateMask: ["theme"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleSignOut = async () => {
    // First, clear auth state and cache BEFORE doing anything else
    await logout();

    try {
      // Then clear user-specific localStorage items
      // Preserve app-wide settings (theme, locale, view preferences, tag view settings)
      const keysToPreserve = ["memos-theme", "memos-locale", "memos-view-setting", "tag-view-as-tree", "tag-tree-auto-expand"];
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !keysToPreserve.includes(key)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore errors from localStorage operations
    }

    // Always redirect to auth page (use replace to prevent back navigation)
    window.location.replace(Routes.AUTH);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!currentUser}>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer flex-row items-center justify-start overflow-hidden rounded-xl text-sidebar-foreground outline-none",
            "transition-colors hover:bg-sidebar-accent/65 focus-visible:ring-2 focus-visible:ring-ring",
            mini ? "h-9 px-2" : "h-11 px-2.5",
          )}
        >
          <div className="relative shrink-0">
            {currentUser?.avatarUrl ? (
              <UserAvatar className={cn("border-sidebar-foreground/15", mini ? "size-5" : "size-7")} avatarUrl={currentUser?.avatarUrl} />
            ) : (
              <User2Icon className={cn("mx-auto text-sidebar-foreground/70", mini ? "size-4" : "size-5")} />
            )}
            {sseStatus !== "connected" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
                      sseStatus === "connecting" ? "bg-muted-foreground animate-pulse" : "bg-destructive",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="right">{t(`live-update.${sseStatus}` as Parameters<typeof t>[0])}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {!collapsed && (
            <span className={cn("grow truncate whitespace-nowrap text-left font-medium", mini ? "ml-2.5 text-xs" : "ml-3 text-sm")}>
              {currentUser?.displayName || currentUser?.username}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => navigateTo(`/u/${encodeURIComponent(currentUser?.username ?? "")}`)}>
          <SquareUserIcon className="size-4 text-muted-foreground" />
          {t("common.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigateTo(Routes.ARCHIVED)}>
          <ArchiveIcon className="size-4 text-muted-foreground" />
          {t("common.archived")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigateTo(Routes.ABOUT)}>
          <InfoIcon className="size-4 text-muted-foreground" />
          {t("common.about")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GlobeIcon className="size-4 text-muted-foreground" />
            {t("common.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto p-0">
            <LocaleSearchList value={currentLocale} onChange={handleLocaleChange} className="w-64" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PaletteIcon className="size-4 text-muted-foreground" />
            {t("setting.preference.theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {THEME_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => handleThemeChange(option.value)}>
                {currentTheme === option.value && <CheckIcon className="w-4 h-auto" />}
                {currentTheme !== option.value && <span className="w-4" />}
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => navigateTo(Routes.SETTING)}>
          <SettingsIcon className="size-4 text-muted-foreground" />
          {t("common.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOutIcon className="size-4 text-muted-foreground" />
          {t("common.sign-out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
