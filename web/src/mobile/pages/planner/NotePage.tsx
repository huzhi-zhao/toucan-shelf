import dayjs from "dayjs";
import { List, ListItem, Navbar, NavbarBackLink, Page, Preloader, Toast } from "konsta/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useDeletePlannerNote, usePlannerNote, useUpdatePlannerNote } from "@/hooks/usePlannerQueries";
import type { PlannerNote } from "@/types/proto/api/v1/planner_service_pb";
import DangerListButton from "../../components/DangerListButton";
import DocPickerSheet from "../../components/DocPickerSheet";
import { LinkedDocsList } from "../../components/LinkedDocs";
import TodoNoteField from "../../components/planner/TodoNoteField";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { isDateEditable, localToday, PLANNER_MAX_UPDATE_DAYS_DEFAULT, PLANNER_MAX_UPDATE_DAYS_KEY } from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { docRoute, MOBILE_ROUTES, noteNameFromUid } from "../../routes";

const EDITABLE_FIELDS = ["content", "remark"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * One note (requirement §2.4.3): its one-line content, a longer remark and linked documents. Text fields save
 * when they lose focus. Like the calendar, it can only be changed within the "N days" limit; older ones are
 * read-only.
 */
export default function NotePage() {
  const { uid = "" } = useParams();
  const name = noteNameFromUid(uid);
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.note.title);
  const today = localToday();
  const [maxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  const { data: note, isPending, isError } = usePlannerNote(name);
  const updateNote = useUpdatePlannerNote();
  const deleteNote = useDeletePlannerNote();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2000);
  };

  // Local drafts of the text fields; only a field whose stored value changed is reset after a save.
  const [drafts, setDrafts] = useState<Record<EditableField, string>>({ content: "", remark: "" });
  const synced = useRef<PlannerNote | undefined>(undefined);
  useEffect(() => {
    if (!note) return;
    const previous = synced.current;
    synced.current = note;
    const changed = EDITABLE_FIELDS.filter((field) => !previous || previous[field] !== note[field]);
    if (changed.length > 0) setDrafts((d) => ({ ...d, ...Object.fromEntries(changed.map((field) => [field, note[field]])) }));
  }, [note]);

  const save = (changes: Partial<Pick<PlannerNote, "content" | "remark" | "memos">>) =>
    updateNote.mutate({ name, changes }, { onError: () => flash(COPY.planner.failed) });

  const commitText = (field: EditableField) => {
    if (!note) return;
    const value = drafts[field].trim();
    if (value === note[field]) return;
    if (field === "content" && !value) {
      setDrafts((d) => ({ ...d, content: note.content }));
      return;
    }
    save({ [field]: value });
  };

  const remove = () => {
    if (!window.confirm(COPY.note.deleteConfirm)) return;
    deleteNote.mutate(name, { onSuccess: back, onError: () => flash(COPY.planner.failed) });
  };

  const header = <Navbar title={COPY.note.title} left={<NavbarBackLink text={backText} showText onClick={back} />} />;
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
  if (isError || !note) {
    return (
      <Page>
        {header}
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.note.notFound}</div>
      </Page>
    );
  }

  const editable = isDateEditable(note.date, today, maxUpdateDays);
  const day = dayjs(note.date);

  return (
    <Page className="pb-safe">
      {header}

      <List strongIos insetIos dividersIos className="mt-4 mb-0">
        <ListItem
          title={
            <textarea
              rows={2}
              value={drafts.content}
              readOnly={!editable}
              onChange={(event) => setDrafts((d) => ({ ...d, content: event.target.value }))}
              onBlur={() => commitText("content")}
              aria-label={COPY.note.content}
              className="w-full bg-transparent outline-none text-[17px] py-0.5 resize-none font-semibold"
            />
          }
        />
        <ListItem title={COPY.todo.date} after={`${day.format("M/D")} ${COPY.planner.weekdays[day.day()]}`} />
      </List>
      {!editable && <div className="px-4 pt-2 text-[12px] text-black/40 dark:text-white/40">{COPY.note.readOnly(maxUpdateDays)}</div>}

      <SectionTitle>{COPY.note.remark}</SectionTitle>
      <div className="mx-4 rounded-xl bg-white dark:bg-[#1c1c1e] p-3">
        {editable ? (
          <TodoNoteField
            value={drafts.remark}
            onChange={(remark) => setDrafts((d) => ({ ...d, remark }))}
            onCommit={() => commitText("remark")}
          />
        ) : (
          <div className="whitespace-pre-wrap text-[16px]">{note.remark}</div>
        )}
      </div>

      <SectionTitle>{COPY.note.doc}</SectionTitle>
      <LinkedDocsList
        memos={note.memos}
        onOpen={(memo) => go(docRoute(memo))}
        onRemove={editable ? (memo) => save({ memos: note.memos.filter((m) => m !== memo) }) : undefined}
        onAdd={editable ? () => setPickerOpen(true) : undefined}
      />

      {editable && (
        <List strongIos insetIos className="mt-8">
          <DangerListButton onClick={remove}>{COPY.note.delete}</DangerListButton>
        </List>
      )}

      <DocPickerSheet
        opened={pickerOpen}
        picked={note.memos}
        onClose={() => setPickerOpen(false)}
        onPick={(memo) => {
          if (!note.memos.includes(memo)) save({ memos: [...note.memos, memo] });
          setPickerOpen(false);
        }}
      />

      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
