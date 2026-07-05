import dayjs from "dayjs";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import MemoView from "@/components/MemoView";
import PagedMemoList from "@/components/PagedMemoList";
import { parseFilterQuery, stringifyFilters, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useView } from "@/contexts/ViewContext";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const Explore = () => {
  const currentUser = useCurrentUser();
  const { compactMode } = useView();
  const { hasFilter, removeFiltersByFactor } = useMemoFilterContext();
  const [searchParams, setSearchParams] = useSearchParams();

  // Default to showing only today's memos when entering Explore, unless a
  // displayTime filter is already present (e.g. from a shared URL). Writing
  // straight to the URL (rather than calling addFilter) avoids racing with
  // MemoFilterContext's own URL<->state sync effects, which can otherwise
  // clobber a filter added immediately after a client-side route change.
  useEffect(() => {
    const existingFilters = parseFilterQuery(searchParams.get("filter"));
    if (existingFilters.some((f) => f.factor === "displayTime")) {
      return;
    }
    const newFilters = stringifyFilters([...existingFilters, { factor: "displayTime", value: dayjs().format("YYYY-MM-DD") }]);
    const newParams = new URLSearchParams(searchParams);
    newParams.set("filter", newFilters);
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The workspace/visibility/archived/displayTime filters are Explore-only;
  // reset them on navigating away so they don't leak into Home's or
  // Archived's filter (which share the same global MemoFilterContext).
  useEffect(() => {
    return () => {
      removeFiltersByFactor("workspace");
      removeFiltersByFactor("visibility");
      removeFiltersByFactor("archived");
      removeFiltersByFactor("displayTime");
    };
  }, [removeFiltersByFactor]);

  // Determine visibility filter based on authentication status
  // - Logged-in users: Can see PUBLIC, PROTECTED, and their own PRIVATE memos
  // - Visitors: Can only see PUBLIC memos
  // Note: The backend is responsible for filtering stats based on visibility permissions.
  // This is only the *default*; the Secondary Sidebar's visibility multi-select
  // (see ExploreVisibilityAndArchivedFilters) can override it via useMemoFilters.
  const visibilities = currentUser ? [Visibility.PUBLIC, Visibility.PROTECTED, Visibility.PRIVATE] : [Visibility.PUBLIC];

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
        <MemoView key={`${memo.name}-${memo.updateTime}`} memo={memo} showCreator showVisibility compact={compactMode} autoFold />
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
