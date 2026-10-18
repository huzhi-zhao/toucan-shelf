import { Button, Link, Navbar, Page } from "konsta/react";
import { SettingsIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMeItems } from "@/hooks/useMeItems";
import MeItemStrip from "../components/MeItemStrip";
import { COPY } from "../copy";
import { useGo } from "../lib/nav";
import { docRoute, MOBILE_ROUTES, meItemRoute, NEW_ME_ITEM } from "../routes";

/**
 * The user's own items (requirement phase 3 §5): strips they set up in settings, each opening a linked
 * document. The app's settings live behind the button in the top right.
 */
export default function MePage() {
  const go = useGo(COPY.me.title);
  const { currentUser } = useAuth();
  const { data: items = [], isLoading } = useMeItems(currentUser?.name);

  return (
    <Page className="pb-tabbar">
      <Navbar
        title={COPY.me.title}
        large
        transparent
        centerTitle
        right={
          <Link iconOnly onClick={() => go(MOBILE_ROUTES.ME_SETTINGS)} aria-label={COPY.me.settings}>
            <SettingsIcon className="w-6 h-6" />
          </Link>
        }
      />
      {items.length > 0 ? (
        <div className="mx-4 mt-3 flex flex-col gap-2.5">
          {items.map((item) => (
            <MeItemStrip key={item.id} item={item} onOpen={item.memo ? () => go(docRoute(item.memo)) : undefined} />
          ))}
        </div>
      ) : (
        !isLoading && (
          <div className="px-8 pt-16 text-center">
            <p className="text-[15px] leading-relaxed text-black/45 dark:text-white/45">{COPY.me.empty}</p>
            <Button rounded inline className="mt-5 px-6" onClick={() => go(meItemRoute(NEW_ME_ITEM))}>
              {COPY.me.addFirst}
            </Button>
          </div>
        )
      )}
    </Page>
  );
}
