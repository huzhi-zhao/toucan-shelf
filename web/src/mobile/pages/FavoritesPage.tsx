import { Link, List, Navbar, NavbarBackLink, Page, Preloader, Toast } from "konsta/react";
import { PinIcon } from "lucide-react";
import { useState } from "react";
import { useFavorites, useSetFavoritePinned } from "@/hooks/useFavorites";
import { cn } from "@/lib/utils";
import FavoriteRow from "../components/FavoriteRow";
import { COPY } from "../copy";
import { useBack, useBackLabel, useGo, usePageScroll } from "../lib/nav";
import { docRoute, MOBILE_ROUTES } from "../routes";

/** Every favorite (phase 3 §2): pinned first, then the newest. The pin button on each row pins or unpins it. */
export default function FavoritesPage() {
  const back = useBack(MOBILE_ROUTES.SHELF);
  const backText = useBackLabel() ?? COPY.shelf.title;
  const go = useGo(COPY.favorites.title);
  const scrollRef = usePageScroll<HTMLDivElement>();
  const { data: favorites, isPending } = useFavorites();
  const setPinned = useSetFavoritePinned();
  const [toast, setToast] = useState("");

  const togglePin = (name: string, pinned: boolean) =>
    setPinned.mutate(
      { name, pinned },
      {
        onError: () => {
          setToast(COPY.favorites.failed);
          setTimeout(() => setToast(""), 2000);
        },
      },
    );

  return (
    <Page ref={scrollRef} className="pb-safe">
      <Navbar
        title={COPY.favorites.title}
        large
        transparent
        centerTitle
        left={<NavbarBackLink text={backText} showText onClick={back} />}
      />
      {isPending ? (
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      ) : !favorites?.length ? (
        <div className="px-8 py-16 text-center text-[15px] leading-relaxed text-black/40 dark:text-white/40">{COPY.favorites.empty}</div>
      ) : (
        <>
          <List strongIos insetIos dividersIos className="mt-4 mb-0">
            {favorites.map((favorite) => (
              <FavoriteRow
                key={favorite.name}
                favorite={favorite}
                onOpen={() => go(docRoute(favorite.memo))}
                after={
                  <Link
                    iconOnly
                    aria-label={favorite.pinned ? COPY.favorites.unpin : COPY.favorites.pin}
                    aria-pressed={favorite.pinned}
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      togglePin(favorite.name, !favorite.pinned);
                    }}
                  >
                    <PinIcon
                      className={cn("h-5 w-5", favorite.pinned ? "text-primary" : "text-black/25 dark:text-white/25")}
                      fill={favorite.pinned ? "currentColor" : "none"}
                    />
                  </Link>
                }
              />
            ))}
          </List>
          <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{COPY.favorites.pinHint}</p>
        </>
      )}
      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
