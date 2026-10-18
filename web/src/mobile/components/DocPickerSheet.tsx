import { useQuery } from "@tanstack/react-query";
import { List, ListItem, Preloader, Searchbar, Sheet } from "konsta/react";
import { ChevronLeftIcon, FileTextIcon, FolderIcon } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { normalizeSortField, normalizeSortOrder, sortTree } from "@/components/Notebook/notebookSort";
import { ragServiceClient } from "@/connect";
import { useWorkspaces, useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import { type Workspace, WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { COPY } from "../copy";
import { countDocuments, findFolderChildren, folderName, parentFolderPath } from "../lib/tree";
import DocGlyph from "./DocGlyph";
import { coverColorOf } from "./WorkspaceCover";

/** Where the browser is: the list of knowledge bases, or a folder ("" is the root) inside one. */
type Place = { workspace?: undefined } | { workspace: Workspace; folderPath: string };

/**
 * One level of a knowledge base, in the same order as the folder pages. A folder drills in; a document is
 * picked.
 */
function FolderLevel({
  workspace,
  folderPath,
  onOpen,
  onPick,
}: {
  workspace: Workspace;
  folderPath: string;
  onOpen: (folderPath: string) => void;
  onPick: (memo: string) => void;
}) {
  const { data: tree, isPending } = useWorkspaceTree(workspace.name, false);
  const nodes = useMemo(() => {
    if (!tree) return undefined;
    const sorted = sortTree(tree, normalizeSortField(workspace.sortField), normalizeSortOrder(workspace.sortOrder), workspace.foldersFirst);
    return findFolderChildren(sorted, folderPath);
  }, [tree, workspace, folderPath]);

  if (isPending) {
    return (
      <div className="flex justify-center py-6">
        <Preloader />
      </div>
    );
  }
  if (!nodes?.length) return <div className="py-10 text-center text-black/40 dark:text-white/40">{COPY.folder.empty}</div>;
  return (
    <List strongIos dividersIos className="!my-0">
      {nodes.map((node) =>
        node.type === WorkspaceTreeNode_NodeType.FOLDER ? (
          <ListItem
            key={`f:${node.path}`}
            link
            title={node.name}
            after={`${countDocuments(node)}`}
            media={<FolderIcon className="h-6 w-6 text-[#3b9cff]" fill="currentColor" strokeWidth={1.2} />}
            onClick={() => onOpen(node.path)}
          />
        ) : (
          <ListItem
            key={node.memo}
            link
            chevron={false}
            title={node.name}
            media={<DocGlyph icon={node.icon} docType={node.docType} size={22} />}
            onClick={() => onPick(node.memo)}
          />
        ),
      )}
    </List>
  );
}

/**
 * Picks a document to link. With nothing searched it browses: the knowledge bases, then folder by folder,
 * the way the shelf does. Searching uses the same global search as the search tab.
 */
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
  const [place, setPlace] = useState<Place>({});
  const { data: workspaces = [], isPending: workspacesPending } = useWorkspaces(false);
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
  const clear = () => {
    setDraft("");
    setQuery("");
  };

  // One level up: the parent folder, the knowledge base's root, then the list of knowledge bases.
  const up = () => {
    if (!place.workspace) return;
    setPlace(place.folderPath ? { workspace: place.workspace, folderPath: parentFolderPath(place.folderPath) } : {});
  };
  const upLabel = !place.workspace
    ? ""
    : place.folderPath
      ? parentFolderPath(place.folderPath)
        ? folderName(parentFolderPath(place.folderPath))
        : place.workspace.title
      : COPY.docPicker.knowledgeBases;
  const here = place.workspace ? (place.folderPath ? folderName(place.folderPath) : place.workspace.title) : COPY.docPicker.knowledgeBases;

  return (
    <Sheet className="pb-safe w-full h-[75vh] rounded-t-2xl flex flex-col" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <form onSubmit={submit} className="px-2 pt-2" action="">
        <Searchbar
          placeholder={COPY.todo.searchDoc}
          value={draft}
          clearButton
          onInput={(event: FormEvent<HTMLInputElement>) => {
            setDraft(event.currentTarget.value);
            if (!event.currentTarget.value) setQuery("");
          }}
          onClear={clear}
        />
      </form>
      <div className="flex-1 overflow-y-auto">
        {query ? (
          <>
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
          </>
        ) : (
          <>
            <div className="flex min-h-11 items-center gap-1 px-4 pt-1">
              {place.workspace && (
                <button type="button" onClick={up} className="-ml-1 flex min-w-0 items-center text-[17px] text-primary active:opacity-50">
                  <ChevronLeftIcon className="h-6 w-6 shrink-0" />
                  <span className="truncate">{upLabel}</span>
                </button>
              )}
              <span className={cn("truncate text-[15px] font-semibold", place.workspace && "ml-auto pl-3")}>{here}</span>
            </div>
            {place.workspace ? (
              <FolderLevel
                key={`${place.workspace.name}:${place.folderPath}`}
                workspace={place.workspace}
                folderPath={place.folderPath}
                onOpen={(folderPath) => place.workspace && setPlace({ workspace: place.workspace, folderPath })}
                onPick={onPick}
              />
            ) : workspacesPending ? (
              <div className="flex justify-center py-6">
                <Preloader />
              </div>
            ) : (
              <List strongIos dividersIos className="!my-0">
                {workspaces.map((workspace) => (
                  <ListItem
                    key={workspace.name}
                    link
                    title={workspace.title}
                    media={<span className="block h-7 w-7 rounded-lg" style={{ background: coverColorOf(workspace) }} />}
                    onClick={() => setPlace({ workspace, folderPath: "" })}
                  />
                ))}
              </List>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
