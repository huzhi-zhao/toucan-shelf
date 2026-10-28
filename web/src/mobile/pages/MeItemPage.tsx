import { create } from "@bufbuild/protobuf";
import {
  Actions,
  ActionsButton,
  ActionsGroup,
  Link,
  List,
  ListItem,
  Navbar,
  NavbarBackLink,
  Page,
  Preloader,
  Segmented,
  SegmentedButton,
  Toast,
} from "konsta/react";
import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { newMeId, useMeItems, useSaveMeItems } from "@/hooks/useMeItems";
import { type UserSetting_MeItem, UserSetting_MeItem_Style, UserSetting_MeItemSchema } from "@/types/proto/api/v1/user_service_pb";
import DangerListButton from "../components/DangerListButton";
import DocPickerSheet from "../components/DocPickerSheet";
import { LinkedDocsList } from "../components/LinkedDocs";
import MeItemStrip, { MeCard, MeGrid, MeTile } from "../components/MeItemStrip";
import SectionTitle from "../components/SectionTitle";
import { COPY } from "../copy";
import { useBlurOnClose } from "../lib/keyboard";
import { useBack, useBackLabel } from "../lib/nav";
import { MOBILE_ROUTES, NEW_ME_ITEM } from "../routes";

type Draft = Pick<UserSetting_MeItem, "icon" | "title" | "note" | "memos" | "style" | "group">;

const EMPTY_DRAFT: Draft = { icon: "", title: "", note: "", memos: [], style: UserSetting_MeItem_Style.MULTI_LINE, group: "" };

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="px-8 mt-2 text-[13px] leading-snug text-black/45 dark:text-white/45">{children}</p>
);

/**
 * Adds or edits one "Me" page item. Nothing is saved until "Done", so a half-filled new item never shows up
 * on the "Me" page; leaving with the back button drops the changes.
 */
export default function MeItemPage() {
  const { id = NEW_ME_ITEM } = useParams();
  const isNew = id === NEW_ME_ITEM;
  const back = useBack(MOBILE_ROUTES.ME_SETTINGS);
  const backText = useBackLabel() ?? COPY.me.settings;
  const { currentUser } = useAuth();
  const { data, isLoading } = useMeItems(currentUser?.name);
  const items = data?.items;
  const groups = data?.groups ?? [];
  const saveItems = useSaveMeItems(currentUser?.name);
  const existing = items?.find((item) => item.id === id);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(isNew);
  useEffect(() => {
    if (loaded || !existing) return;
    setDraft({
      icon: existing.icon,
      title: existing.title,
      note: existing.note,
      memos: [...existing.memos],
      style: existing.style,
      group: existing.group,
    });
    setLoaded(true);
  }, [existing, loaded]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  useBlurOnClose(pickerOpen || groupOpen);
  // A group deleted since the item was opened reads as no group.
  const group = groups.find((g) => g.id === draft.group);
  const [toast, setToast] = useState("");
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  const title = draft.title.trim();
  const save = (next: UserSetting_MeItem[]) =>
    saveItems.mutate(
      { items: next, groups },
      {
        onSuccess: back,
        onError: () => {
          setToast(COPY.me.failed);
          setTimeout(() => setToast(""), 2000);
        },
      },
    );

  const done = () => {
    if (!title || !items) return;
    const item = create(UserSetting_MeItemSchema, {
      ...draft,
      id: isNew ? newMeId() : id,
      icon: draft.icon.trim(),
      title,
      note: draft.note.trim(),
      group: group?.id ?? "",
    });
    save(isNew ? [...items, item] : items.map((it) => (it.id === id ? item : it)));
  };

  const header = (
    <Navbar
      title={isNew ? COPY.me.newItem : COPY.me.editItem}
      left={<NavbarBackLink text={backText} showText onClick={back} />}
      right={
        <Link onClick={done} className={title && items ? "font-semibold" : "pointer-events-none opacity-30"}>
          {COPY.me.done}
        </Link>
      }
    />
  );

  if (!isNew && !existing) {
    return (
      <Page>
        {header}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Preloader />
          </div>
        ) : (
          <div className="py-16 text-center text-black/40 dark:text-white/40">{COPY.me.notFound}</div>
        )}
      </Page>
    );
  }

  // The row's own title takes its natural width; the field fills the rest, its text on the right.
  const rowInputClass =
    "w-full min-w-0 bg-transparent text-right text-[17px] text-black dark:text-white outline-none placeholder:text-black/25 dark:placeholder:text-white/25";

  return (
    <Page className="pb-safe">
      {header}

      {/* Title and icon as labelled rows, the field on the right of each, like iOS Settings. */}
      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        <ListItem
          title={COPY.me.itemTitle}
          after={
            <input
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder={COPY.me.titlePlaceholder}
              aria-label={COPY.me.itemTitle}
              className={rowInputClass}
            />
          }
        />
        <ListItem
          title={COPY.me.icon}
          after={
            <input
              value={draft.icon}
              onChange={(event) => set({ icon: event.target.value })}
              placeholder={COPY.me.iconPlaceholder}
              aria-label={COPY.me.icon}
              className={rowInputClass}
            />
          }
        />
        {groups.length > 0 && (
          <ListItem
            link
            title={COPY.me.group}
            after={group?.title ?? <span className="text-black/30 dark:text-white/30">{COPY.me.noGroup}</span>}
            onClick={() => setGroupOpen(true)}
          />
        )}
      </List>

      <SectionTitle>{COPY.me.note}</SectionTitle>
      <div className="mx-4 rounded-xl bg-white p-3 dark:bg-[#1c1c1e]">
        <textarea
          rows={3}
          value={draft.note}
          onChange={(event) => set({ note: event.target.value })}
          placeholder={COPY.me.notePlaceholder}
          aria-label={COPY.me.note}
          className="w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
        />
      </div>

      <SectionTitle>{COPY.me.style}</SectionTitle>
      <div className="mx-4">
        <Segmented strong>
          <SegmentedButton
            active={draft.style !== UserSetting_MeItem_Style.SINGLE_LINE && draft.style !== UserSetting_MeItem_Style.GRID}
            onClick={() => set({ style: UserSetting_MeItem_Style.MULTI_LINE })}
          >
            {COPY.me.multiLine}
          </SegmentedButton>
          <SegmentedButton
            active={draft.style === UserSetting_MeItem_Style.SINGLE_LINE}
            onClick={() => set({ style: UserSetting_MeItem_Style.SINGLE_LINE })}
          >
            {COPY.me.singleLine}
          </SegmentedButton>
          <SegmentedButton
            active={draft.style === UserSetting_MeItem_Style.GRID}
            onClick={() => set({ style: UserSetting_MeItem_Style.GRID })}
          >
            {COPY.me.grid}
          </SegmentedButton>
        </Segmented>
      </div>
      <Hint>{COPY.me.styleHint}</Hint>

      {/* How it will look on the "Me" page, with the style chosen above. */}
      <SectionTitle>{COPY.me.preview}</SectionTitle>
      {draft.style === UserSetting_MeItem_Style.GRID ? (
        <MeGrid>
          <MeTile item={create(UserSetting_MeItemSchema, { ...draft, id, title: draft.title || COPY.me.previewTitle })} />
        </MeGrid>
      ) : (
        <MeCard>
          <MeItemStrip
            item={create(UserSetting_MeItemSchema, { ...draft, title: draft.title || COPY.me.previewTitle })}
            chevron={draft.memos.length > 0}
          />
        </MeCard>
      )}

      <SectionTitle>{COPY.me.doc}</SectionTitle>
      <LinkedDocsList
        memos={draft.memos}
        onRemove={(memo) => set({ memos: draft.memos.filter((m) => m !== memo) })}
        onAdd={() => setPickerOpen(true)}
      />
      {draft.memos.length > 1 && <Hint>{COPY.me.docsHint}</Hint>}

      {!isNew && items && (
        <List strongIos insetIos className="mt-7">
          <DangerListButton onClick={() => window.confirm(COPY.me.confirmDelete) && save(items.filter((it) => it.id !== id))}>
            {COPY.me.deleteItem}
          </DangerListButton>
        </List>
      )}

      <DocPickerSheet
        opened={pickerOpen}
        picked={draft.memos}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          if (!draft.memos.includes(memo)) set({ memos: [...draft.memos, memo] });
          setPickerOpen(false);
        }}
      />

      <Actions opened={groupOpen} onBackdropClick={() => setGroupOpen(false)}>
        <ActionsGroup>
          {groups.map((g) => (
            <ActionsButton
              key={g.id}
              bold={g.id === group?.id}
              onClick={() => {
                set({ group: g.id });
                setGroupOpen(false);
              }}
            >
              {g.title}
            </ActionsButton>
          ))}
          <ActionsButton
            bold={!group}
            onClick={() => {
              set({ group: "" });
              setGroupOpen(false);
            }}
          >
            {COPY.me.noGroup}
          </ActionsButton>
        </ActionsGroup>
        <ActionsGroup>
          <ActionsButton onClick={() => setGroupOpen(false)}>{COPY.planner.cancel}</ActionsButton>
        </ActionsGroup>
      </Actions>

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
