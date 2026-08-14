import SearchBar from "@/components/SearchBar";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import type { StatisticsData } from "@/types/statistics";
import StatisticsView from "../StatisticsView";
import { ExploreVisibilityAndArchivedFilters, ExploreWorkspaceSelect } from "./ExploreFilters";
import ShortcutsSection from "./ShortcutsSection";
import TagsSection from "./TagsSection";

export type MemoExplorerContext = "home" | "explore" | "archived" | "profile";

export interface MemoExplorerFeatures {
  search?: boolean;
  statistics?: boolean;
  shortcuts?: boolean;
  tags?: boolean;
}

interface Props {
  className?: string;
  context?: MemoExplorerContext;
  features?: MemoExplorerFeatures;
  statisticsData: StatisticsData;
  tagCount: Record<string, number>;
}

const getDefaultFeatures = (context: MemoExplorerContext): MemoExplorerFeatures => {
  switch (context) {
    case "explore":
      return {
        search: true,
        statistics: true,
        shortcuts: false, // Global explore doesn't use shortcuts
        tags: true,
      };
    case "archived":
      return {
        search: true,
        statistics: true,
        shortcuts: false, // Archived doesn't typically use shortcuts
        tags: true,
      };
    case "profile":
      return {
        search: true,
        statistics: true,
        shortcuts: false, // Profile view doesn't use shortcuts
        tags: true,
      };
    case "home":
    default:
      return {
        search: true,
        statistics: true,
        shortcuts: true,
        tags: true,
      };
  }
};

const MemoExplorer = (props: Props) => {
  const { className, context = "home", features: featureOverrides = {}, statisticsData, tagCount } = props;
  const currentUser = useCurrentUser();

  // Merge default features with overrides
  const features = {
    ...getDefaultFeatures(context),
    ...featureOverrides,
  };

  return (
    <aside
      className={cn("relative w-full h-full flex flex-col justify-start items-start bg-background text-sidebar-foreground", className)}
    >
      <div className="w-full flex-1 min-h-0 overflow-auto flex flex-col">
        {context === "explore" && (
          <div className="w-full mb-2">
            <ExploreWorkspaceSelect />
          </div>
        )}
        {features.search && <SearchBar />}
        <div className="mt-1 px-1 w-full">
          {features.statistics && <StatisticsView statisticsData={statisticsData} />}
          {features.shortcuts && currentUser && <ShortcutsSection />}
          {features.tags && <TagsSection readonly={context === "explore"} tagCount={tagCount} />}
        </div>
      </div>
      {context === "explore" && (
        <div className="shrink-0 w-full px-1 flex flex-col gap-2">
          <ExploreVisibilityAndArchivedFilters />
        </div>
      )}
    </aside>
  );
};

export default MemoExplorer;
