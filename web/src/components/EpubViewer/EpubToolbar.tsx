import type { NavItem } from "epubjs";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  ScrollTextIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { EpubSettings } from "./epubSettings";
import { EpubSettingsMenu } from "./EpubSettingsMenu";
import type { EpubFlow } from "./useEpubRendition";

interface Props {
  toc: NavItem[];
  flow: EpubFlow;
  loading: boolean;
  fontScale: number;
  canDecreaseFont: boolean;
  canIncreaseFont: boolean;
  settings: EpubSettings;
  onSettingsChange: (patch: Partial<EpubSettings>) => void;
  /** Annotate mode: when on, selecting text authors a comment. Omit to hide the toggle. */
  annotateMode?: boolean;
  onToggleAnnotateMode?: () => void;
  /** Whether the comments panel is open. Omit (with onToggleSidebar) to hide the button. */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFlow: () => void;
  onDecreaseFont: () => void;
  onIncreaseFont: () => void;
  onNavigate: (href: string) => void;
  className?: string;
}

// Flattens the (possibly nested) EPUB table of contents into a single list with an
// indent depth, so the chapter dropdown can show sub-chapters without a nested menu.
const flattenToc = (items: NavItem[], depth = 0): { item: NavItem; depth: number }[] =>
  items.flatMap((item) => [{ item, depth }, ...(item.subitems ? flattenToc(item.subitems, depth + 1) : [])]);

export const EpubToolbar = ({
  toc,
  flow,
  loading,
  fontScale,
  canDecreaseFont,
  canIncreaseFont,
  settings,
  onSettingsChange,
  annotateMode,
  onToggleAnnotateMode,
  sidebarOpen,
  onToggleSidebar,
  onPrev,
  onNext,
  onToggleFlow,
  onDecreaseFont,
  onIncreaseFont,
  onNavigate,
  className,
}: Props) => {
  const t = useTranslate();
  const flatToc = flattenToc(toc);

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={flatToc.length === 0} title={t("epub.contents")}>
            <ListIcon className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
          {flatToc.map(({ item, depth }) => (
            <DropdownMenuItem
              key={item.id || item.href}
              onSelect={() => onNavigate(item.href)}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
              className="truncate text-sm"
            >
              {item.label.trim()}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon" onClick={onToggleFlow} title={t("epub.toggle-flow")}>
        {flow === "paginated" ? <BookOpenIcon className="w-4 h-4" /> : <ScrollTextIcon className="w-4 h-4" />}
      </Button>

      <Button variant="ghost" size="icon" disabled={loading} onClick={onPrev} title={t("epub.previous")}>
        <ChevronLeftIcon className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="icon" disabled={loading} onClick={onNext} title={t("epub.next")}>
        <ChevronRightIcon className="w-4 h-4" />
      </Button>

      <Button variant="ghost" size="icon" disabled={!canDecreaseFont} onClick={onDecreaseFont} title={t("epub.font-smaller")}>
        <span className="text-xs font-semibold">A-</span>
      </Button>
      <span className="text-sm text-muted-foreground min-w-12 text-center">{Math.round(fontScale * 100)}%</span>
      <Button variant="ghost" size="icon" disabled={!canIncreaseFont} onClick={onIncreaseFont} title={t("epub.font-larger")}>
        <span className="text-sm font-semibold">A+</span>
      </Button>

      {onToggleAnnotateMode && (
        <Button variant={annotateMode ? "secondary" : "ghost"} size="icon" onClick={onToggleAnnotateMode} title={t("epub.add-annotation")}>
          <MessageSquarePlusIcon className="w-4 h-4" />
        </Button>
      )}
      {onToggleSidebar && (
        <Button variant={sidebarOpen ? "secondary" : "ghost"} size="icon" onClick={onToggleSidebar} title={t("epub.annotations")}>
          <MessageSquareTextIcon className="w-4 h-4" />
        </Button>
      )}

      <EpubSettingsMenu settings={settings} onChange={onSettingsChange} />
    </div>
  );
};
