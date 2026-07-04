import { useEffect } from "react";
import MemoView from "@/components/MemoView";
import PagedMemoList from "@/components/PagedMemoList";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useView } from "@/contexts/ViewContext";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const Explore = () => {
  const currentUser = useCurrentUser();
  const { compactMode } = useView();
  const { hasFilter, removeFiltersByFactor } = useMemoFilterContext();

  // The workspace/visibility/archived filters are Explore-only; reset them on
  // navigating away so they don't leak into Home's or Archived's filter (which
  // share the same global MemoFilterContext).
  useEffect(() => {
    return () => {
      removeFiltersByFactor("workspace");
      removeFiltersByFactor("visibility");
      removeFiltersByFactor("archived");
    };
  }, [removeFiltersByFactor]);

  // Determine visibility filter based on authentication status
  // - Logged-in users: Can see PUBLIC and PROTECTED memos
  // - Visitors: Can only see PUBLIC memos
  // Note: The backend is responsible for filtering stats based on visibility permissions.
  // This is only the *default*; the Secondary Sidebar's visibility multi-select
  // (see ExploreVisibilityAndArchivedFilters) can override it via useMemoFilters.
  const visibilities = currentUser ? [Visibility.PUBLIC, Visibility.PROTECTED] : [Visibility.PUBLIC];

  // Build filter using unified hook (no creator scoping for Explore). This also
  // folds in the workspace and visibility selections from the Secondary Sidebar.
  const memoFilter = useMemoFilters({
    includeShortcuts: false,
    includePinned: false,
    visibilities,
  });

  const archived = hasFilter({ factor: "archived", value: "true" });
  const state = archived ? State.ARCHIVED : State.NORMAL;

  // Get sorting logic using unified hook (no pinned sorting)
  const { listSort, orderBy } = useMemoSorting({
    pinnedFirst: false,
    state,
  });

  return (
    <PagedMemoList
      renderer={(memo: Memo) => (
        <MemoView key={`${memo.name}-${memo.updateTime}`} memo={memo} showCreator showVisibility compact={compactMode} />
      )}
      listSort={listSort}
      orderBy={orderBy}
      filter={memoFilter}
      state={state}
      showCreator
    />
  );
};

export default Explore;
