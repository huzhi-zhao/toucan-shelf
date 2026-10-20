import { Actions, ActionsButton, ActionsGroup, ActionsLabel, List, ListButton, ListItem } from "konsta/react";
import { MinusCircleIcon } from "lucide-react";
import { useMemo as useMemoQuery } from "@/hooks/useMemoQueries";
import { Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { COPY } from "../copy";
import DocGlyph from "./DocGlyph";

/**
 * A linked document as the lists show it, read from the document itself. A deleted or unreadable one says so,
 * so it can still be removed; the name stands in while it loads.
 */
function useLinkedDoc(memo: string) {
  const { data, isError } = useMemoQuery(memo, { enabled: Boolean(memo) });
  if (isError) return { title: COPY.linkedDocs.missing, icon: "", docType: "" };
  return { title: data?.title || memo, icon: data?.icon ?? "", docType: data ? Memo_DocType[data.docType] : "" };
}

function DocRow({ memo, onOpen, onRemove }: { memo: string; onOpen?: () => void; onRemove?: () => void }) {
  const doc = useLinkedDoc(memo);
  return (
    <ListItem
      link={Boolean(onOpen)}
      chevron={false}
      media={<DocGlyph icon={doc.icon} docType={doc.docType} size={22} />}
      title={<span className="block truncate">{doc.title}</span>}
      after={
        onRemove && (
          <button
            type="button"
            aria-label={COPY.linkedDocs.remove}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="-my-2 -mr-2 p-2 text-red-500 active:opacity-50"
          >
            <MinusCircleIcon className="h-5 w-5" />
          </button>
        )
      }
      onClick={onOpen}
    />
  );
}

/**
 * The documents linked to a todo, a "Me" item or a habit plan, in order, each removable, with a row to add
 * another (the caller opens the picker). Tapping a document opens it when `onOpen` is given. Without
 * `onRemove` and `onAdd` the list is read-only.
 */
export function LinkedDocsList({
  memos,
  onOpen,
  onRemove,
  onAdd,
}: {
  memos: string[];
  onOpen?: (memo: string) => void;
  onRemove?: (memo: string) => void;
  onAdd?: () => void;
}) {
  return (
    <List strongIos insetIos dividersIos className="!my-0">
      {memos.map((memo) => (
        <DocRow key={memo} memo={memo} onOpen={onOpen && (() => onOpen(memo))} onRemove={onRemove && (() => onRemove(memo))} />
      ))}
      {onAdd && <ListButton onClick={onAdd}>{memos.length > 0 ? COPY.linkedDocs.addAnother : COPY.linkedDocs.add}</ListButton>}
    </List>
  );
}

function ChooserButton({ memo, onPick }: { memo: string; onPick: () => void }) {
  return <ActionsButton onClick={onPick}>{useLinkedDoc(memo).title}</ActionsButton>;
}

/** Asks which of several linked documents to open. */
export function LinkedDocsChooser({
  title,
  memos,
  opened,
  onClose,
  onPick,
}: {
  title: string;
  memos: string[];
  opened: boolean;
  onClose: () => void;
  onPick: (memo: string) => void;
}) {
  return (
    <Actions opened={opened} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{title}</ActionsLabel>
        {memos.map((memo) => (
          <ChooserButton key={memo} memo={memo} onPick={() => onPick(memo)} />
        ))}
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton onClick={onClose} bold>
          {COPY.planner.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}
