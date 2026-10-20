import { create } from "@bufbuild/protobuf";
import { closestCenter, DndContext, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  ActionsLabel,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Sheet,
  Toast,
} from "konsta/react";
import { FolderPlusIcon, GripVerticalIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { flattenSections, type MeItems, type MeSection, meSections, newMeId, useMeItems, useSaveMeItems } from "@/hooks/useMeItems";
import { cn } from "@/lib/utils";
import { type UserSetting_MeGroup, UserSetting_MeGroupSchema, type UserSetting_MeItem } from "@/types/proto/api/v1/user_service_pb";
import DangerListButton from "../components/DangerListButton";
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

/** One block of items in the editor: its own card, rows reorderable within it. */
function SectionCard({
  section,
  onOpen,
  onReorder,
}: {
  section: MeSection;
  onOpen: (item: UserSetting_MeItem) => void;
  onReorder: (items: UserSetting_MeItem[]) => void;
}) {
  // The handle starts a drag at once (it has `touch-action: none`, so the page does not scroll from it);
  // the rest of the row stays a plain tap target.
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = section.items.findIndex((item) => item.id === active.id);
    const to = section.items.findIndex((item) => item.id === over.id);
    onReorder(arrayMove(section.items, from, to));
  };
  return (
    <div className="mx-4 overflow-hidden rounded-3xl bg-white dark:bg-[#1c1c1e]">
      {section.items.length === 0 ? (
        <p className="px-4 py-3 text-[15px] text-black/40 dark:text-white/40">{COPY.me.groupEmpty}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={section.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {/* Own wrapper, so the last row is a last child: DndContext adds its screen-reader nodes after it. */}
            <div>
              {section.items.map((item) => (
                <SortableRow key={item.id} item={item} onOpen={() => onOpen(item)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/** Names a new group, or renames one. */
function GroupNameSheet({
  opened,
  initial,
  onClose,
  onSave,
}: {
  opened: boolean;
  initial: string;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    if (opened) setDraft(initial);
  }, [opened, initial]);
  const title = draft.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title) onSave(title);
  };
  return (
    <Sheet className="pb-safe w-full rounded-t-2xl" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <form onSubmit={submit} className="px-4 pt-3">
        <div className="mb-2 text-[15px] font-semibold">{initial ? COPY.me.renameGroup : COPY.me.newGroup}</div>
        <input
          value={draft}
          maxLength={50}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={COPY.me.groupPlaceholder}
          aria-label={COPY.me.group}
          className="w-full rounded-xl bg-black/5 px-3 py-2.5 text-[16px] outline-none dark:bg-white/10"
        />
        <div className="flex justify-end gap-4 py-3">
          <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={onClose}>
            {COPY.planner.cancel}
          </button>
          <button type="submit" className="text-[16px] font-semibold text-primary disabled:opacity-40" disabled={!title}>
            {COPY.me.done}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * The app's settings and the editor for the "Me" page's items (requirement phase 3 §5): one card per group,
 * as the page shows them. Rows drag within their group; an item changes group on its own page.
 */
export default function MeSettingsPage() {
  const navigate = useNavigate();
  const back = useBack(MOBILE_ROUTES.ME);
  const backText = useBackLabel() ?? COPY.me.title;
  const go = useGo(COPY.me.settings);
  const { currentUser, logout } = useAuth();
  const [fontSize] = usePref(READER_FONT_SIZE_KEY, READER_FONT_SIZE_DEFAULT);
  const { data } = useMeItems(currentUser?.name);
  const saveItems = useSaveMeItems(currentUser?.name);
  const [toast, setToast] = useState("");
  const items = data?.items ?? [];
  const groups = data?.groups ?? [];
  const sections = meSections({ items, groups });
  // The items outside every group get a card only when there are some, or when there are no groups at all
  // (then that card is the whole list).
  const shown = sections.filter((section) => section.group || section.items.length > 0 || groups.length === 0);

  // The group whose menu is open (kept while the menu slides away), and the name sheet: new group or rename.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuGroup, setMenuGroup] = useState<UserSetting_MeGroup>();
  const [naming, setNaming] = useState<{ group?: UserSetting_MeGroup } | null>(null);

  const commit = (next: MeItems) =>
    saveItems.mutate(next, {
      onError: () => {
        setToast(COPY.me.failed);
        setTimeout(() => setToast(""), 2000);
      },
    });

  const reorder = (index: number, reordered: UserSetting_MeItem[]) =>
    commit({ items: flattenSections(sections.map((section, i) => (i === index ? { ...section, items: reordered } : section))), groups });

  const saveGroupName = (title: string) => {
    const renaming = naming?.group;
    setNaming(null);
    commit({
      items,
      groups: renaming
        ? groups.map((g) => (g.id === renaming.id ? create(UserSetting_MeGroupSchema, { ...g, title }) : g))
        : [...groups, create(UserSetting_MeGroupSchema, { id: newMeId(), title })],
    });
  };

  const moveGroup = (group: UserSetting_MeGroup, by: -1 | 1) => {
    setMenuOpen(false);
    const from = groups.findIndex((g) => g.id === group.id);
    const to = from + by;
    if (to < 0 || to >= groups.length) return;
    commit({ items, groups: arrayMove(groups, from, to) });
  };

  // Deleting a group keeps its items: they move out to the ungrouped card.
  const deleteGroup = (group: UserSetting_MeGroup) => {
    setMenuOpen(false);
    if (!window.confirm(COPY.me.confirmDeleteGroup(group.title))) return;
    commit({
      items: items.map((item) => (item.group === group.id ? { ...item, group: "" } : item)),
      groups: groups.filter((g) => g.id !== group.id),
    });
  };

  const signOut = async () => {
    await logout();
    navigate(MOBILE_ROUTES.AUTH, { replace: true });
  };

  const menuIndex = menuGroup ? groups.findIndex((g) => g.id === menuGroup.id) : -1;

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
      {shown.map((section) => (
        <div key={section.group?.id ?? ""} className="mb-5">
          {section.group ? (
            <div className="flex items-center justify-between pl-8 pr-5 pb-1">
              <span className="truncate text-[13px] text-black/45 dark:text-white/45">{section.group.title}</span>
              <button
                type="button"
                aria-label={COPY.me.groupMenu}
                onClick={() => {
                  setMenuGroup(section.group);
                  setMenuOpen(true);
                }}
                className="-my-1 p-1 text-black/45 active:opacity-50 dark:text-white/45"
              >
                <MoreHorizontalIcon className="h-5 w-5" />
              </button>
            </div>
          ) : (
            groups.length > 0 && <div className="px-8 pb-1.5 text-[13px] text-black/45 dark:text-white/45">{COPY.me.ungrouped}</div>
          )}
          <SectionCard
            section={section}
            onOpen={(item) => go(meItemRoute(item.id))}
            onReorder={(reordered) => reorder(sections.indexOf(section), reordered)}
          />
        </div>
      ))}
      <div className="mx-4 overflow-hidden rounded-3xl bg-white dark:bg-[#1c1c1e]">
        <button
          type="button"
          onClick={() => go(meItemRoute(NEW_ME_ITEM))}
          className="relative flex w-full items-center gap-3 py-3 pl-4 text-left text-[17px] text-primary active:opacity-50 after:absolute after:bottom-0 after:left-14 after:right-0 after:h-px after:bg-black/10 dark:after:bg-white/10"
        >
          <PlusIcon className="h-5 w-7 shrink-0" />
          {COPY.me.addItem}
        </button>
        <button
          type="button"
          onClick={() => setNaming({})}
          className="flex w-full items-center gap-3 py-3 pl-4 text-left text-[17px] text-primary active:opacity-50"
        >
          <FolderPlusIcon className="h-5 w-7 shrink-0" />
          {COPY.me.addGroup}
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
        <DangerListButton onClick={signOut}>{COPY.me.signOut}</DangerListButton>
      </List>

      <Actions opened={menuOpen} onBackdropClick={() => setMenuOpen(false)}>
        <ActionsGroup>
          <ActionsLabel>{menuGroup?.title}</ActionsLabel>
          <ActionsButton
            onClick={() => {
              setMenuOpen(false);
              setNaming({ group: menuGroup });
            }}
          >
            {COPY.me.renameGroup}
          </ActionsButton>
          {menuGroup && menuIndex > 0 && <ActionsButton onClick={() => moveGroup(menuGroup, -1)}>{COPY.me.moveGroupUp}</ActionsButton>}
          {menuGroup && menuIndex >= 0 && menuIndex < groups.length - 1 && (
            <ActionsButton onClick={() => moveGroup(menuGroup, 1)}>{COPY.me.moveGroupDown}</ActionsButton>
          )}
          {menuGroup && (
            <ActionsButton className="!text-red-500" onClick={() => deleteGroup(menuGroup)}>
              {COPY.me.deleteGroup}
            </ActionsButton>
          )}
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton bold onClick={() => setMenuOpen(false)}>
            {COPY.planner.cancel}
          </ActionsButton>
        </ActionsGroup>
      </Actions>

      <GroupNameSheet
        opened={naming !== null}
        initial={naming?.group?.title ?? ""}
        onClose={() => setNaming(null)}
        onSave={saveGroupName}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
