import { Button, Link, Navbar, Page } from "konsta/react";
import { SettingsIcon } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { meSections, useMeItems } from "@/hooks/useMeItems";
import type { UserSetting_MeItem } from "@/types/proto/api/v1/user_service_pb";
import { LinkedDocsChooser } from "../components/LinkedDocs";
import MeItemStrip, { MeCard } from "../components/MeItemStrip";
import { COPY } from "../copy";
import { useGo } from "../lib/nav";
import { docRoute, MOBILE_ROUTES, meItemRoute, NEW_ME_ITEM } from "../routes";

/**
 * The user's own items (requirement phase 3 §5), set up in settings: one card per group, the items outside
 * every group first and under no heading. An item opens its linked document, or asks which one when it has
 * several. The app's settings live behind the button in the top right.
 */
export default function MePage() {
  const go = useGo(COPY.me.title);
  const { currentUser } = useAuth();
  const { data, isLoading } = useMeItems(currentUser?.name);
  const sections = data ? meSections(data).filter((section) => section.items.length > 0) : [];
  // The chooser keeps showing the last item while it slides away.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chosen, setChosen] = useState<UserSetting_MeItem>();

  const open = (item: UserSetting_MeItem) => {
    if (item.memos.length === 1) {
      go(docRoute(item.memos[0]));
      return;
    }
    setChosen(item);
    setChooserOpen(true);
  };

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
      {sections.length > 0 ? (
        <div className="pt-3">
          {sections.map((section) => (
            <section key={section.group?.id ?? ""} className="mb-6">
              {section.group && <h2 className="px-8 pb-1.5 text-[13px] text-black/45 dark:text-white/45">{section.group.title}</h2>}
              <MeCard>
                {section.items.map((item) => (
                  <MeItemStrip key={item.id} item={item} onOpen={item.memos.length > 0 ? () => open(item) : undefined} />
                ))}
              </MeCard>
            </section>
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
      <LinkedDocsChooser
        title={chosen?.title ?? ""}
        memos={chosen?.memos ?? []}
        opened={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPick={(memo) => {
          setChooserOpen(false);
          go(docRoute(memo));
        }}
      />
    </Page>
  );
}
