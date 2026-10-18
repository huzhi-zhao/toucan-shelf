import { closestCenter, DndContext, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Toast } from "konsta/react";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useMeItems, useSaveMeItems } from "@/hooks/useMeItems";
import { cn } from "@/lib/utils";
import type { UserSetting_MeItem } from "@/types/proto/api/v1/user_service_pb";
import SectionTitle from "../components/SectionTitle";
import { COPY } from "../copy";
import { useBack, useBackLabel, useGo } from "../lib/nav";
import { READER_FONT_SIZE_DEFAULT, READER_FONT_SIZE_KEY } from "../lib/reading";
import { usePref } from "../lib/storage";
import { MOBILE_ROUTES, meItemRoute, NEW_ME_ITEM } from "../routes";

// Konsta's BlockFooter tucks itself under the list above with a negative margin, which only works with the
// list's default margins; these lists have none (see SectionTitle).
const Hint = ({ children }: { children: ReactNode }) => (
  <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{children}</p>
);

/** One item in the reorderable list: tap the row to edit it, drag the handle to move it. */
function SortableRow({ item, onOpen }: { item: UserSetting_MeItem; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      // Rows only move up and down.
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
      className={cn(
        "relative flex items-center bg-white dark:bg-[#1c1c1e]",
        "after:absolute after:bottom-0 after:left-14 after:right-0 after:h-px after:bg-black/10 dark:after:bg-white/10 last:after:hidden",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:opacity-50">
        <span className="w-7 shrink-0 text-center text-[20px] leading-none">{item.icon}</span>
        <span className="min-w-0 flex-1 truncate text-[17px]">{item.title}</span>
      </button>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={COPY.me.drag}
        className="touch-none cursor-grab px-4 py-3 text-black/30 dark:text-white/30"
      >
        <GripVerticalIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

/** The app's settings and the editor for the "Me" page's items (requirement phase 3 §5). */
export default function MeSettingsPage() {
  const navigate = useNavigate();
  const back = useBack(MOBILE_ROUTES.ME);
  const backText = useBackLabel() ?? COPY.me.title;
  const go = useGo(COPY.me.settings);
  const { currentUser, logout } = useAuth();
  const [fontSize] = usePref(READER_FONT_SIZE_KEY, READER_FONT_SIZE_DEFAULT);
  const { data: items = [] } = useMeItems(currentUser?.name);
  const saveItems = useSaveMeItems(currentUser?.name);
  const [toast, setToast] = useState("");

  // The handle starts a drag at once (it has `touch-action: none`, so the page does not scroll from it);
  // the rest of the row stays a plain tap target.
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    saveItems.mutate(arrayMove(items, from, to), {
      onError: () => {
        setToast(COPY.me.failed);
        setTimeout(() => setToast(""), 2000);
      },
    });
  };

  const signOut = async () => {
    await logout();
    navigate(MOBILE_ROUTES.AUTH, { replace: true });
  };

  return (
    <Page className="pb-safe">
      <Navbar title={COPY.me.settings} left={<NavbarBackLink text={backText} showText onClick={back} />} />

      <List strongIos insetIos className="mt-4 mb-0">
        <ListItem
          title={currentUser?.displayName || currentUser?.username}
          text={currentUser?.username}
          media={<UserAvatar className="w-11 h-11" avatarUrl={currentUser?.avatarUrl} />}
        />
      </List>

      <SectionTitle>{COPY.me.items}</SectionTitle>
      <div className="mx-4 overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e]">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <SortableRow key={item.id} item={item} onOpen={() => go(meItemRoute(item.id))} />
            ))}
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={() => go(meItemRoute(NEW_ME_ITEM))}
          className={cn(
            "flex w-full items-center gap-3 py-3 pl-4 text-left text-[17px] text-primary active:opacity-50",
            items.length > 0 && "border-t border-black/10 dark:border-white/10",
          )}
        >
          <PlusIcon className="h-5 w-7 shrink-0" />
          {COPY.me.addItem}
        </button>
      </div>
      {items.length > 1 && <Hint>{COPY.me.itemsHint}</Hint>}

      <SectionTitle>{COPY.me.reading}</SectionTitle>
      <List strongIos insetIos className="!my-0">
        <ListItem title={COPY.me.fontSize} after={`${fontSize}px`} />
        <ListItem title={COPY.me.darkMode} after={COPY.me.followSystem} />
      </List>
      <Hint>{COPY.me.readingHint}</Hint>

      <List strongIos insetIos className="mt-7 mb-0">
        <ListItem title={COPY.me.homeScreen} text={<span className="whitespace-normal">{COPY.me.homeScreenHint}</span>} />
      </List>
      <List strongIos insetIos className="mt-7">
        <ListButton className="text-red-500" onClick={signOut}>
          {COPY.me.signOut}
        </ListButton>
      </List>

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
