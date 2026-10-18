import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { List, ListButton, ListItem, Navbar, NavbarBackLink, Page, Preloader, Searchbar, Sheet, Toast, Toggle } from "konsta/react";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ragServiceClient } from "@/connect";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { useDeleteTodo, usePostponeTodo, useTodo, useUpdateTodo } from "@/hooks/usePlannerQueries";
import { cn } from "@/lib/utils";
import { type Todo, Todo_Status } from "@/types/proto/api/v1/planner_service_pb";
import { SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBlurOnClose } from "../../lib/keyboard";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { isOverdue, localToday, postponeChoices } from "../../lib/planner";
import { docRoute, MOBILE_ROUTES, todoNameFromUid } from "../../routes";

const EDITABLE_FIELDS = ["title", "tag", "note", "url"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const isWebLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/**
 * One todo (requirement §2.2): title, day, importance, tag, note, a linked document
 * and an external link. Text fields save when they lose focus; the rest at once.
 * Closing happens here too — cancelling asks for the reason first — and so does postponing,
 * which moves the date but keeps the original one and counts (requirement §2.3).
 */
export default function TodoPage() {
  const { uid = "" } = useParams();
  const name = todoNameFromUid(uid);
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.todo.title);
  const today = localToday();
  const { data: todo, isPending, isError } = useTodo(name);
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const [toast, setToast] = useState("");
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2000);
  };

  // Local drafts of the text fields. Every save refetches the todo, so only a field whose stored value
  // changed is reset; resetting all of them would wipe what is being typed in another field meanwhile.
  const [drafts, setDrafts] = useState<Record<EditableField, string>>({ title: "", tag: "", note: "", url: "" });
  const synced = useRef<Todo | undefined>(undefined);
  useEffect(() => {
    if (!todo) return;
    const previous = synced.current;
    synced.current = todo;
    const changed = EDITABLE_FIELDS.filter((field) => !previous || previous[field] !== todo[field]);
    if (changed.length > 0) setDrafts((d) => ({ ...d, ...Object.fromEntries(changed.map((field) => [field, todo[field]])) }));
  }, [todo]);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const postponeTodo = usePostponeTodo();
  useBlurOnClose(cancelOpen || postponeOpen || pickerOpen);

  const postpone = (date: string) => {
    setPostponeOpen(false);
    if (!todo || !date || date === todo.date || date < today) return;
    postponeTodo.mutate({ name, date, localDate: today }, { onError: () => flash(COPY.planner.failed) });
  };

  const save = (
    changes: Partial<Pick<Todo, "title" | "date" | "status" | "cancelReason" | "important" | "tag" | "note" | "memo" | "url">>,
  ) => updateTodo.mutate({ name, changes, localDate: today }, { onError: () => flash(COPY.planner.failed) });

  const commitText = (field: EditableField) => {
    if (!todo) return;
    const value = drafts[field].trim();
    if (value === todo[field]) return;
    if (field === "title" && !value) {
      setDrafts((d) => ({ ...d, title: todo.title }));
      return;
    }
    if (field === "url" && value && !isWebLink(value)) {
      flash(COPY.todo.urlInvalid);
      return;
    }
    save({ [field]: value });
  };

  const confirmCancel = () => {
    if (!reason.trim()) return;
    save({ status: Todo_Status.CANCELLED, cancelReason: reason.trim() });
    setCancelOpen(false);
  };

  const remove = () => {
    if (!window.confirm(COPY.todo.deleteConfirm)) return;
    deleteTodo.mutate(name, { onSuccess: back, onError: () => flash(COPY.planner.failed) });
  };

  const linkedDoc = useMemoQuery(todo?.memo ?? "", { enabled: Boolean(todo?.memo) });

  const header = <Navbar title={COPY.todo.title} left={<NavbarBackLink text={backText} showText onClick={back} />} />;
  if (isPending) {
    return (
      <Page>
        {header}
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      </Page>
    );
  }
  if (isError || !todo) {
    return (
      <Page>
        {header}
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.todo.notFound}</div>
      </Page>
    );
  }

  const overdue = isOverdue(todo, today);
  const closed = todo.status !== Todo_Status.ACTIVE;
  const closedOn = todo.closeTime ? dayjs(Number(todo.closeTime.seconds) * 1000).format("YYYY-MM-DD") : "";
  const statusLabel =
    todo.status === Todo_Status.DONE
      ? COPY.todo.done
      : todo.status === Todo_Status.CANCELLED
        ? COPY.todo.cancelled
        : overdue
          ? COPY.todo.overdue
          : COPY.todo.active;
  const inputClass = "w-full bg-transparent outline-none text-[17px] py-0.5";

  return (
    <Page className="pb-safe">
      {header}

      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        <ListItem
          title={
            <input
              value={drafts.title}
              onChange={(event) => setDrafts((d) => ({ ...d, title: event.target.value }))}
              onBlur={() => commitText("title")}
              aria-label={COPY.todo.name}
              className={cn(inputClass, "font-semibold", todo.status === Todo_Status.CANCELLED && "line-through")}
            />
          }
        />
        <ListItem
          title={COPY.todo.date}
          after={
            <input
              type="date"
              value={todo.date}
              onChange={(event) => save({ date: event.target.value })}
              className={cn("bg-transparent text-right outline-none", overdue && "text-red-500")}
            />
          }
        />
        <ListItem
          title={COPY.todo.important}
          after={<Toggle checked={todo.important} onChange={() => save({ important: !todo.important })} />}
        />
        <ListItem
          title={COPY.todo.tag}
          after={
            <input
              value={drafts.tag}
              onChange={(event) => setDrafts((d) => ({ ...d, tag: event.target.value }))}
              onBlur={() => commitText("tag")}
              className="bg-transparent text-right outline-none w-40"
            />
          }
        />
      </List>

      <SectionTitle>{COPY.todo.note}</SectionTitle>
      <div className="mx-4 rounded-xl bg-white dark:bg-[#1c1c1e] p-3">
        <textarea
          rows={4}
          value={drafts.note}
          onChange={(event) => setDrafts((d) => ({ ...d, note: event.target.value }))}
          onBlur={() => commitText("note")}
          className="w-full bg-transparent outline-none resize-none text-[16px]"
        />
      </div>

      <SectionTitle>{COPY.todo.doc}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        {todo.memo ? (
          <>
            <ListItem
              link
              media={<FileTextIcon className="w-5 h-5 text-black/45 dark:text-white/45" />}
              title={linkedDoc.data?.title || todo.memo}
              onClick={() => go(docRoute(todo.memo))}
            />
            <ListButton onClick={() => save({ memo: "" })} className="text-red-500">
              {COPY.todo.removeDoc}
            </ListButton>
          </>
        ) : (
          <ListButton onClick={() => setPickerOpen(true)}>{COPY.todo.pickDoc}</ListButton>
        )}
      </List>

      <SectionTitle>{COPY.todo.url}</SectionTitle>
      <List strongIos insetIos dividersIos className="!my-0">
        <ListItem
          title={
            <input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={drafts.url}
              onChange={(event) => setDrafts((d) => ({ ...d, url: event.target.value }))}
              onBlur={() => commitText("url")}
              className={inputClass}
            />
          }
        />
        {todo.url && (
          <ListItem
            link
            chevron={false}
            href={todo.url}
            target="_blank"
            title={COPY.todo.openUrl}
            after={<ExternalLinkIcon className="w-4 h-4" />}
          />
        )}
      </List>

      <SectionTitle>
        {statusLabel}
        {closed && todo.closedOverdue && <span className="ml-2 text-[13px] font-normal text-red-500">{COPY.todo.closedOverdue}</span>}
      </SectionTitle>
      {todo.status === Todo_Status.CANCELLED && todo.cancelReason && (
        <div className="mx-4 mb-2 text-[15px] text-black/60 dark:text-white/60">
          {COPY.todo.cancelReason}：{todo.cancelReason}
        </div>
      )}
      {closedOn && <div className="mx-4 mb-2 text-[13px] text-black/40 dark:text-white/40">{closedOn}</div>}
      {todo.postponeCount > 0 && (
        <div className="mx-4 mb-2 text-[13px] text-black/50 dark:text-white/50">
          {COPY.todo.postponed(dayjs(todo.originalDate).format("M/D"), todo.postponeCount)}
        </div>
      )}
      <List strongIos insetIos dividersIos className="!my-0">
        {closed ? (
          <ListButton onClick={() => save({ status: Todo_Status.ACTIVE })}>{COPY.todo.reopen}</ListButton>
        ) : (
          <>
            <ListButton onClick={() => save({ status: Todo_Status.DONE })}>{COPY.todo.complete}</ListButton>
            {todo.date && <ListButton onClick={() => setPostponeOpen(true)}>{COPY.todo.postpone}</ListButton>}
            <ListButton
              className="text-red-500"
              onClick={() => {
                setReason("");
                setCancelOpen(true);
              }}
            >
              {COPY.todo.cancelTodo}
            </ListButton>
          </>
        )}
      </List>

      <List strongIos insetIos className="mt-8">
        <ListButton className="text-red-500" onClick={remove}>
          {COPY.todo.deleteTodo}
        </ListButton>
      </List>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={cancelOpen} onBackdropClick={() => setCancelOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3">
          <div className="text-[15px] font-semibold mb-2">{COPY.todo.cancelReason}</div>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={COPY.todo.cancelReasonPlaceholder}
            className="w-full rounded-xl bg-black/5 dark:bg-white/10 p-3 text-[16px] outline-none resize-none"
          />
          <div className="flex justify-end gap-4 py-3">
            <button type="button" className="text-[16px] text-black/50 dark:text-white/50" onClick={() => setCancelOpen(false)}>
              {COPY.planner.cancel}
            </button>
            <button
              type="button"
              className="text-[16px] font-semibold text-red-500 disabled:opacity-40"
              disabled={!reason.trim()}
              onClick={confirmCancel}
            >
              {COPY.todo.confirmCancel}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet className="pb-safe w-full rounded-t-2xl" opened={postponeOpen} onBackdropClick={() => setPostponeOpen(false)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="px-4 pt-3 text-[15px] font-semibold">{COPY.todo.postponeTo}</div>
        <List strongIos insetIos dividersIos className="!my-3">
          {postponeChoices(today, todo.date).map(({ choice, date }) => (
            <ListItem
              key={choice}
              link
              chevron={false}
              title={COPY.todo[choice]}
              after={`${dayjs(date).format("M/D")} ${COPY.planner.weekdays[dayjs(date).day()]}`}
              onClick={() => postpone(date)}
            />
          ))}
          <ListItem
            title={COPY.todo.pickDate}
            after={
              <input
                type="date"
                min={today}
                value=""
                onChange={(event) => postpone(event.target.value)}
                className="bg-transparent text-right outline-none"
              />
            }
          />
        </List>
      </Sheet>

      <DocPickerSheet
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          save({ memo });
          setPickerOpen(false);
        }}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}

/** Picks a document to link, through the same global search as the search tab. */
function DocPickerSheet({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (memo: string) => void }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["mobile-search", query],
    queryFn: () => ragServiceClient.search({ query, scope: { case: "global", value: true }, mode: SearchMode.UNSPECIFIED, limit: 0 }),
    enabled: query !== "",
    staleTime: 60_000,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
    (document.activeElement as HTMLElement | null)?.blur();
  };

  return (
    <Sheet className="pb-safe w-full h-[75vh] rounded-t-2xl flex flex-col" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <form onSubmit={submit} className="px-2 pt-2" action="">
        <Searchbar
          placeholder={COPY.todo.searchDoc}
          value={draft}
          clearButton
          onInput={(event: FormEvent<HTMLInputElement>) => setDraft(event.currentTarget.value)}
          onClear={() => setDraft("")}
        />
      </form>
      <div className="flex-1 overflow-y-auto">
        {isFetching && (
          <div className="flex justify-center py-6">
            <Preloader />
          </div>
        )}
        <List strongIos dividersIos className="!my-0">
          {(data?.hits ?? []).map((hit) => (
            <ListItem
              key={hit.memo}
              link
              chevron={false}
              media={<FileTextIcon className="w-5 h-5 text-black/45 dark:text-white/45" />}
              title={hit.title}
              text={hit.folderPath || undefined}
              onClick={() => onPick(hit.memo)}
            />
          ))}
        </List>
      </div>
    </Sheet>
  );
}
