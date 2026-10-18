import { create } from "@bufbuild/protobuf";
import { Link, List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Segmented, SegmentedButton, Toast } from "konsta/react";
import { FileTextIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMeItems, useSaveMeItems } from "@/hooks/useMeItems";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { type UserSetting_MeItem, UserSetting_MeItem_Style, UserSetting_MeItemSchema } from "@/types/proto/api/v1/user_service_pb";
import DocPickerSheet from "../components/DocPickerSheet";
import MeItemStrip from "../components/MeItemStrip";
import SectionTitle from "../components/SectionTitle";
import { COPY } from "../copy";
import { useBlurOnClose } from "../lib/keyboard";
import { useBack, useBackLabel } from "../lib/nav";
import { MOBILE_ROUTES, NEW_ME_ITEM } from "../routes";

type Draft = Pick<UserSetting_MeItem, "icon" | "title" | "note" | "memo" | "style">;

const EMPTY_DRAFT: Draft = { icon: "", title: "", note: "", memo: "", style: UserSetting_MeItem_Style.MULTI_LINE };

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

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
  const { data: items, isLoading } = useMeItems(currentUser?.name);
  const saveItems = useSaveMeItems(currentUser?.name);
  const existing = items?.find((item) => item.id === id);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(isNew);
  useEffect(() => {
    if (loaded || !existing) return;
    setDraft({ icon: existing.icon, title: existing.title, note: existing.note, memo: existing.memo, style: existing.style });
    setLoaded(true);
  }, [existing, loaded]);

  const [pickerOpen, setPickerOpen] = useState(false);
  useBlurOnClose(pickerOpen);
  const linkedDoc = useMemoQuery(draft.memo, { enabled: Boolean(draft.memo) });
  const [toast, setToast] = useState("");
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  const title = draft.title.trim();
  const save = (next: UserSetting_MeItem[]) =>
    saveItems.mutate(next, {
      onSuccess: back,
      onError: () => {
        setToast(COPY.me.failed);
        setTimeout(() => setToast(""), 2000);
      },
    });

  const done = () => {
    if (!title || !items) return;
    const item = create(UserSetting_MeItemSchema, {
      ...draft,
      id: isNew ? newId() : id,
      icon: draft.icon.trim(),
      title,
      note: draft.note.trim(),
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
            active={draft.style !== UserSetting_MeItem_Style.SINGLE_LINE}
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
        </Segmented>
      </div>
      <Hint>{COPY.me.styleHint}</Hint>

      {/* How it will look on the "Me" page, with the style chosen above. */}
      <SectionTitle>{COPY.me.preview}</SectionTitle>
      <div className="mx-4">
        <MeItemStrip item={create(UserSetting_MeItemSchema, { ...draft, title: draft.title || COPY.me.previewTitle, memo: draft.memo })} />
      </div>

      <SectionTitle>{COPY.me.doc}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {draft.memo ? (
          <>
            <ListItem
              media={<FileTextIcon className="h-5 w-5 text-black/45 dark:text-white/45" />}
              title={linkedDoc.data?.title || draft.memo}
            />
            <ListButton onClick={() => set({ memo: "" })} className="text-red-500">
              {COPY.me.removeDoc}
            </ListButton>
          </>
        ) : (
          <ListButton onClick={() => setPickerOpen(true)}>{COPY.me.pickDoc}</ListButton>
        )}
      </List>

      {!isNew && items && (
        <List strongIos insetIos className="mt-7">
          <ListButton
            className="text-red-500"
            onClick={() => window.confirm(COPY.me.confirmDelete) && save(items.filter((it) => it.id !== id))}
          >
            {COPY.me.deleteItem}
          </ListButton>
        </List>
      )}

      <DocPickerSheet
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          set({ memo });
          setPickerOpen(false);
        }}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
