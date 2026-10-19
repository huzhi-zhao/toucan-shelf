import { List, ListItem, Navbar, Page, Preloader, Segmented, SegmentedButton } from "konsta/react";
import { useFavorites } from "@/hooks/useFavorites";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import FavoriteRow from "../components/FavoriteRow";
import SectionTitle from "../components/SectionTitle";
import WorkspaceCover, { coverColorOf } from "../components/WorkspaceCover";
import { COPY } from "../copy";
import { useGo, usePageScroll } from "../lib/nav";
import { RECENT_KEY, type RecentRead } from "../lib/recent";
import { usePref } from "../lib/storage";
import { docRoute, folderRoute, MOBILE_ROUTES } from "../routes";

type ShelfView = "cover" | "list";

/** How many unpinned favorites the shelf shows; pinned ones are always shown and do not count. */
const SHELF_FAVORITES = 5;

export default function ShelfPage() {
  const go = useGo(COPY.shelf.title);
  const scrollRef = usePageScroll<HTMLDivElement>();
  // Hidden knowledge bases never show on the phone, and there is no switch to reveal them (requirement §4).
  const { data: workspaces = [], isPending } = useWorkspaces(false);
  const [recent] = usePref<RecentRead[]>(RECENT_KEY, []);
  const [view, setView] = usePref<ShelfView>("shelf-view", "cover");
  const { data: favorites = [] } = useFavorites();
  const pinnedCount = favorites.filter((favorite) => favorite.pinned).length;
  const shelfFavorites = favorites.slice(0, pinnedCount + SHELF_FAVORITES);

  return (
    <Page ref={scrollRef} className="pb-tabbar">
      <Navbar title={COPY.shelf.title} large transparent centerTitle />

      {recent.length > 0 && (
        <>
          <SectionTitle>{COPY.shelf.recent}</SectionTitle>
          {/* scroll-padding keeps snapped cards aligned with the page margin instead of the screen edge. */}
          <div className="flex gap-3 overflow-x-auto px-4 scroll-px-4 snap-x snap-mandatory pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((read) => (
              <button
                type="button"
                key={read.memoName}
                onClick={() => go(docRoute(read.memoName))}
                className="snap-start shrink-0 w-36 rounded-2xl bg-white dark:bg-[#1c1c1e] p-3 text-left active:opacity-60 transition-opacity"
              >
                <div className="text-2xl leading-none h-7">{read.icon || "📄"}</div>
                <div className="mt-2 text-[15px] font-medium leading-snug line-clamp-2">{read.title}</div>
                <div className="mt-1 text-xs text-black/45 dark:text-white/45 truncate">{read.workspaceTitle}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <SectionTitle
        className="mt-8"
        action={
          <Segmented rounded className="!w-auto">
            <SegmentedButton active={view === "cover"} onClick={() => setView("cover")} className="!px-3">
              {COPY.shelf.cover}
            </SegmentedButton>
            <SegmentedButton active={view === "list"} onClick={() => setView("list")} className="!px-3">
              {COPY.shelf.list}
            </SegmentedButton>
          </Segmented>
        }
      >
        {COPY.shelf.mine}
      </SectionTitle>

      {isPending ? (
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.shelf.empty}</div>
      ) : view === "cover" ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 px-4">
          {workspaces.map((workspace) => (
            <WorkspaceCover key={workspace.name} workspace={workspace} onClick={() => go(folderRoute(workspace.name))} />
          ))}
        </div>
      ) : (
        <List strongIos insetIos className="!my-0">
          {workspaces.map((workspace) => (
            <ListItem
              key={workspace.name}
              link
              title={workspace.title}
              media={<span className="block w-7 h-7 rounded-lg" style={{ background: coverColorOf(workspace) }} />}
              onClick={() => go(folderRoute(workspace.name))}
            />
          ))}
        </List>
      )}

      {favorites.length > 0 && (
        <>
          <SectionTitle
            className="mt-8"
            action={
              favorites.length > shelfFavorites.length && (
                <button type="button" className="text-[15px] text-primary active:opacity-50" onClick={() => go(MOBILE_ROUTES.FAVORITES)}>
                  {COPY.shelf.allFavorites(favorites.length)}
                </button>
              )
            }
          >
            {COPY.shelf.favorites}
          </SectionTitle>
          <List strongIos insetIos dividersIos className="!my-0">
            {shelfFavorites.map((favorite) => (
              <FavoriteRow key={favorite.name} favorite={favorite} onOpen={() => go(docRoute(favorite.memo))} />
            ))}
          </List>
        </>
      )}
    </Page>
  );
}
