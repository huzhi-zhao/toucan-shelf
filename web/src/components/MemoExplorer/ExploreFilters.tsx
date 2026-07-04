import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

const ALL_PROJECTS_VALUE = "__all__";

const VISIBILITY_OPTIONS = ["PRIVATE", "PROTECTED", "PUBLIC"] as const;

// Explore-only Secondary Sidebar filters: a workspace selector above the
// search box, and a visibility multi-select + archived checkbox below it.
export const ExploreWorkspaceSelect = () => {
  const t = useTranslate();
  const { data: workspaces = [] } = useWorkspaces();
  const { getFiltersByFactor, addFilter, removeFiltersByFactor } = useMemoFilterContext();

  const selected = getFiltersByFactor("workspace")[0]?.value;

  const handleChange = (value: string) => {
    removeFiltersByFactor("workspace");
    if (value !== ALL_PROJECTS_VALUE) {
      addFilter({ factor: "workspace", value });
    }
  };

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <Select value={selected ?? ALL_PROJECTS_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("explore.all-projects")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PROJECTS_VALUE}>{t("explore.all-projects")}</SelectItem>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.name} value={workspace.name}>
            {workspace.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const ExploreVisibilityAndArchivedFilters = () => {
  const t = useTranslate();
  const { getFiltersByFactor, hasFilter, addFilter, removeFilter } = useMemoFilterContext();

  const selectedVisibilities = new Set(getFiltersByFactor("visibility").map((f) => f.value));
  // No explicit selection means "everything allowed" — render all boxes as checked
  // and default to that state, per spec ("默认全选").
  const isAllImplicit = selectedVisibilities.size === 0;
  const archived = hasFilter({ factor: "archived", value: "true" });

  const toggleVisibility = (value: string, checked: boolean) => {
    if (isAllImplicit) {
      // Coming from the implicit "all" state: turning one off means we must now
      // pin down the remaining ones explicitly so the filter reflects intent.
      VISIBILITY_OPTIONS.filter((v) => v !== value).forEach((v) => addFilter({ factor: "visibility", value: v }));
      return;
    }
    if (checked) {
      addFilter({ factor: "visibility", value });
    } else {
      removeFilter((f) => f.factor === "visibility" && f.value === value);
    }
  };

  const toggleArchived = (checked: boolean) => {
    removeFilter((f) => f.factor === "archived");
    if (checked) {
      addFilter({ factor: "archived", value: "true" });
    }
  };

  const summaryLabel = isAllImplicit
    ? t("explore.all-visibilities")
    : VISIBILITY_OPTIONS.filter((v) => selectedVisibilities.has(v))
        .map((v) => t(`memo.visibility.${v.toLowerCase() as "private" | "protected" | "public"}`))
        .join(", ");

  return (
    <div className="w-full flex flex-col gap-2 mt-1">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("explore.filter-by-visibility")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between font-normal">
              <span className="truncate">{summaryLabel}</span>
              <ChevronDownIcon className="w-4 h-4 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            {VISIBILITY_OPTIONS.map((value) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={isAllImplicit || selectedVisibilities.has(value)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => toggleVisibility(value, Boolean(checked))}
              >
                {t(`memo.visibility.${value.toLowerCase() as "private" | "protected" | "public"}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="explore-archived" checked={archived} onCheckedChange={(v) => toggleArchived(Boolean(v))} />
        <Label htmlFor="explore-archived" className={cn("text-sm cursor-pointer", archived && "text-primary")}>
          {t("explore.show-archived-only")}
        </Label>
      </div>
    </div>
  );
};
