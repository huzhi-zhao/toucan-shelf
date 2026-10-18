import { useQuery } from "@tanstack/react-query";
import { List, ListItem, Preloader, Searchbar, Sheet } from "konsta/react";
import { FileTextIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ragServiceClient } from "@/connect";
import { SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import { COPY } from "../copy";

/** Picks a document to link, through the same global search as the search tab. */
export default function DocPickerSheet({
  opened,
  onClose,
  onPick,
}: {
  opened: boolean;
  onClose: () => void;
  onPick: (memo: string) => void;
}) {
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
