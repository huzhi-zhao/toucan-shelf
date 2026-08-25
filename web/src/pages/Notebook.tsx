import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import copy from "copy-to-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DocumentLinkProvider, flattenWorkspaceDocuments, resolveWorkspacePath } from "@/components/MemoContent/DocumentLinkContext";
import { EmbedAncestryProvider } from "@/components/MemoContent/EmbedAncestryContext";
import DocumentView from "@/components/Notebook/DocumentView";
import LibrarySearchResults from "@/components/Notebook/LibrarySearchResults";
import MoveDocumentDialog from "@/components/Notebook/MoveDocumentDialog";
import MoveFolderDialog from "@/components/Notebook/MoveFolderDialog";
import NotebookSidebar from "@/components/Notebook/NotebookSidebar";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { memoServiceClient, ragServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { useCreateAttachment } from "@/hooks/useAttachmentQueries";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLastOpened } from "@/hooks/useLastOpened";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useCreateMemo, useDeleteMemo, useMemo as useMemoDetail, useUpdateMemo } from "@/hooks/useMemoQueries";
import useNotebookSidebarCollapsed from "@/hooks/useNotebookSidebarCollapsed";
import usePageTitle from "@/hooks/usePageTitle";
import {
  useCreateWorkspaceFolder,
  useDeleteWorkspaceFolder,
  useMoveWorkspaceFolder,
  useRenameWorkspaceFolder,
  useWorkspaces,
  useWorkspaceTree,
  workspaceKeys,
} from "@/hooks/useWorkspaceQueries";
import { handleError } from "@/lib/error";
import { AttachmentOrigin, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { State } from "@/types/proto/api/v1/common_pb";
import { type DocConfig, DocConfigSchema, Memo_DocType, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { type SearchHit, SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { resolveMemoDocConfig } from "@/utils/docConfig";
import { resolveHeadingTarget } from "@/utils/heading-anchor";
import { useTranslate } from "@/utils/i18n";
import { setNotebookSidebarOverride } from "@/utils/notebookSidebar";

function findFirstDocument(nodes: WorkspaceTreeNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT) return node.memo;
    const found = findFirstDocument(node.children);
    if (found) return found;
  }
  return undefined;
}

function containsMemo(nodes: WorkspaceTreeNode[], memoName: string): boolean {
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT && node.memo === memoName) return true;
    if (containsMemo(node.children, memoName)) return true;
  }
  return false;
}

function detectDocType(fileName: string): Memo_DocType {
  return /\.html?$/i.test(fileName) ? Memo_DocType.HTML : Memo_DocType.MARKDOWN;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown|html|htm|pdf)$/i, "");
}

// URLs show the bare UID, not the `memos/{uid}` resource name used internally.
// A new site home page starts with a feed already in it. The server refuses a
// home page without one — a layout of prose and curated galleries is frozen the
// moment it is saved, leaving everything published afterwards reachable only by
// URL — so the starting point is the smallest layout that is actually allowed.
const NEW_SITE_HOME_LAYOUT = JSON.stringify(
  { viewType: "gallery", blocks: [{ type: "public_feed", title: "Latest", tags: [], showTopicFilter: true }] },
  null,
  2,
);

const memoUid = (memoName: string) => memoName.replace(/^memos\//, "");

const Notebook = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { profile } = useInstance();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceTitle, docId } = useParams<{ workspaceTitle?: string; docId?: string }>();
  const { data: workspaces = [] } = useWorkspaces();
  const sidebarCollapsed = useNotebookSidebarCollapsed();
  // Phone-sized viewports (and tablets rotated to portrait) can't afford the 288px tree next to
  // the document, so the secondary sidebar starts closed there — see the override effect below.
  const isNarrow = !useMediaQuery("md");
  const { getLastOpened, setLastOpened } = useLastOpened(currentUser?.name);
  const requestedWorkspace =
    (location.state as { workspace?: string } | null)?.workspace ??
    workspaces.find((w) => w.title.toLowerCase() === workspaceTitle?.toLowerCase())?.name;
  // The URL carries the bare memo UID; older links carry the full `memos/{uid}`
  // resource name (percent-encoded), so accept both.
  const requestedMemo = docId ? (docId.startsWith("memos/") ? docId : `memos/${docId}`) : undefined;

  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [selectedMemo, setSelectedMemo] = useState<string | undefined>(undefined);
  // A heading fragment to scroll to once the freshly-selected document has rendered. Set when an
  // in-workspace link carries an anchor (`document/abc#h-…`); consumed by the scroll effect below.
  const pendingScrollHash = useRef<string | undefined>(undefined);
  const [archived, setArchived] = useState(false);
  // In-library (F2) search state. `search` is null when no search is active.
  const [search, setSearch] = useState<{ query: string; hits: SearchHit[]; degraded: boolean } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const restoredWorkspace = useRef(false);
  const restoredMemo = useRef(false);

  const [newDocDialog, setNewDocDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [newViewDialog, setNewViewDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [newBlogViewDialog, setNewBlogViewDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [newFolderDialog, setNewFolderDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [renameFolderDialog, setRenameFolderDialog] = useState<{
    path: string;
  } | null>(null);
  const [moveFolderDialog, setMoveFolderDialog] = useState<{
    path: string;
  } | null>(null);
  // Move targets whichever document's row menu was used, which is not necessarily the open one.
  const [moveDocDialog, setMoveDocDialog] = useState<{
    memoName: string;
  } | null>(null);

  const { data: tree = [] } = useWorkspaceTree(workspaceName, archived);
  const { data: memo } = useMemoDetail(selectedMemo ?? "", {
    enabled: !!selectedMemo,
  });
  usePageTitle(memo?.title);

  // When an in-workspace link carried an anchor (`document/abc#h-…`), scroll to the heading once
  // the newly-selected document has rendered. The markdown renders asynchronously, so retry across
  // a few animation frames until the target appears (or give up after ~1.5s).
  useEffect(() => {
    const hash = pendingScrollHash.current;
    if (!hash || memo?.name !== selectedMemo) return;
    let raf = 0;
    const deadline = performance.now() + 1500;
    const tick = () => {
      const target = resolveHeadingTarget(document, hash);
      if (target) {
        pendingScrollHash.current = undefined;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (performance.now() < deadline) raf = requestAnimationFrame(tick);
      else pendingScrollHash.current = undefined;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [memo?.name, selectedMemo]);

  // A document can opt out of the folder tree in its document settings, giving a clean
  // full-width reading view (e.g. a landing/homepage doc). This feeds a transient
  // per-document override in the sidebar store: it collapses the tree by default while such a
  // document is open, a manual toggle of the switch reveals it in one click, and switching to a
  // normal document restores the user's saved preference. The override is cleared on unmount so
  // it never leaks to the rest of the app.
  const docHidesFilter = useMemo(() => !resolveMemoDocConfig(memo).displayFilter, [memo?.docConfig]);
  // The same override channel carries the narrow-viewport default: on a phone (or after rotating
  // to portrait) the tree starts collapsed regardless of the saved desktop preference, and one tap
  // on the toggle still opens it — a manual toggle clears the override.
  useEffect(() => {
    setNotebookSidebarOverride(docHidesFilter || isNarrow ? true : null);
  }, [selectedMemo, docHidesFilter, isNarrow]);
  useEffect(() => () => setNotebookSidebarOverride(null), []);

  // Keep the secondary sidebar visible when the knowledge base has no documents,
  // otherwise a freshly created (empty) workspace would render a blank page.
  const effectiveSidebarCollapsed = sidebarCollapsed && tree.length > 0;

  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const createAttachment = useCreateAttachment();
  const createFolder = useCreateWorkspaceFolder();
  const renameFolder = useRenameWorkspaceFolder();
  const moveFolder = useMoveWorkspaceFolder();
  const deleteFolder = useDeleteWorkspaceFolder();

  // Restore last-opened workspace once workspaces are available. A workspace requested via
  // navigation state (e.g. clicking a book on the Bookshelf) takes priority and is applied
  // synchronously, so the switch is immediate instead of waiting on a server round-trip.
  useEffect(() => {
    if (restoredWorkspace.current || workspaces.length === 0) return;
    restoredWorkspace.current = true;
    if (requestedWorkspace && workspaces.some((w) => w.name === requestedWorkspace)) {
      setWorkspaceName(requestedWorkspace);
      return;
    }
    (async () => {
      const lastOpened = await getLastOpened();
      const match = lastOpened && workspaces.find((w) => w.name === lastOpened.workspace);
      setWorkspaceName(match ? match.name : workspaces[0].name);
    })();
  }, [workspaces, getLastOpened, requestedWorkspace]);

  // Restore last-opened document once the tree for the restored workspace loads.
  useEffect(() => {
    if (restoredMemo.current || !workspaceName || tree.length === 0) return;
    restoredMemo.current = true;
    if (requestedMemo && containsMemo(tree, requestedMemo)) {
      setSelectedMemo(requestedMemo);
      return;
    }
    (async () => {
      const lastOpened = await getLastOpened();
      const lastMemo = lastOpened?.workspaceMemos[workspaceName];
      if (lastMemo && containsMemo(tree, lastMemo)) {
        setSelectedMemo(lastMemo);
      } else {
        setSelectedMemo(findFirstDocument(tree));
      }
    })();
  }, [workspaceName, tree, getLastOpened, requestedMemo]);

  useEffect(() => {
    if (workspaceName && selectedMemo) {
      setLastOpened(workspaceName, selectedMemo);
    }
  }, [workspaceName, selectedMemo, setLastOpened]);

  const searchHitMemos = useMemo(() => (search ? new Set(search.hits.map((hit) => hit.memo)) : null), [search]);

  const handleLibrarySearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || !workspaceName) {
        setSearch(null);
        return;
      }
      setSearchLoading(true);
      try {
        const response = await ragServiceClient.search({
          query,
          scope: { case: "workspace", value: workspaceName },
          mode: SearchMode.UNSPECIFIED,
          limit: 0,
        });
        setSelectedMemo(undefined); // show the results list (not a stale open document)
        setSearch({ query, hits: response.hits, degraded: response.effectiveMode === SearchMode.KEYWORD });
      } catch (error) {
        handleError(error, toast.error, { context: t("common.search") });
      } finally {
        setSearchLoading(false);
      }
    },
    [workspaceName, t],
  );

  const handleWorkspaceChange = useCallback(
    (name: string) => {
      setWorkspaceName(name);
      setSelectedMemo(undefined);
      setSearch(null); // a library search is scoped to one workspace; drop it on switch
      restoredMemo.current = false; // auto-select the workspace's last-opened doc once its tree loads
      const title = workspaces.find((w) => w.name === name)?.title ?? name;
      navigate(`/${encodeURIComponent(title)}`, { replace: true });
    },
    [workspaces, navigate],
  );

  const handleSelectDocument = useCallback(
    (memoName: string, anchorHref?: string) => {
      // Opening a document (incl. a search hit) shows it in the preview but KEEPS the
      // active search: the folder tree stays filtered to the hits so the user can keep
      // browsing results. Clearing the search box is what restores the full tree.
      const hashIndex = anchorHref?.indexOf("#") ?? -1;
      pendingScrollHash.current = hashIndex >= 0 ? anchorHref!.slice(hashIndex + 1) : undefined;
      setSelectedMemo(memoName);
      if (workspaceName) {
        const title = workspaces.find((w) => w.name === workspaceName)?.title ?? workspaceName;
        navigate(`/${encodeURIComponent(title)}/${encodeURIComponent(memoUid(memoName))}`, { replace: true });
      }
    },
    [workspaceName, workspaces, navigate],
  );

  const handleOpenInNewTab = useCallback(() => {
    if (!workspaceName) return;
    const title = workspaces.find((w) => w.name === workspaceName)?.title ?? workspaceName;
    const path = selectedMemo
      ? `/${encodeURIComponent(title)}/${encodeURIComponent(memoUid(selectedMemo))}`
      : `/${encodeURIComponent(title)}`;
    window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
  }, [workspaceName, selectedMemo, workspaces]);

  const handleOpenDocumentInNewTab = useCallback(
    (memoName: string) => {
      if (!workspaceName) return;
      const title = workspaces.find((w) => w.name === workspaceName)?.title ?? workspaceName;
      const path = `/${encodeURIComponent(title)}/${encodeURIComponent(memoUid(memoName))}`;
      window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
    },
    [workspaceName, workspaces],
  );

  const invalidateTree = useCallback(() => {
    if (workspaceName) {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(workspaceName, false),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(workspaceName, true),
      });
    }
  }, [queryClient, workspaceName]);

  const handleCreateDocument = useCallback(
    async (folderPath: string, title: string, docType: Memo_DocType = Memo_DocType.MARKDOWN, content?: string, docConfig?: DocConfig) => {
      if (!workspaceName) return;
      try {
        const created = await createMemo.mutateAsync(
          create(MemoSchema, {
            workspace: workspaceName,
            folderPath,
            title,
            docType,
            docConfig,
            content:
              content ??
              (docType === Memo_DocType.HTML ? `<!doctype html>\n<html>\n<body>\n<h1>${title}</h1>\n</body>\n</html>\n` : `# ${title}\n`),
          }),
        );
        invalidateTree();
        setSelectedMemo(created.name);
      } catch (error) {
        handleError(error, toast.error, {
          context: t("notebook.new-document"),
        });
      }
    },
    [workspaceName, createMemo, invalidateTree, t],
  );

  const handleUpload = useCallback(
    async (folderPath: string, file: File) => {
      const content = await file.text();
      const docType = detectDocType(file.name);
      // Markdown written outside this app follows CommonMark, where a newline inside
      // a paragraph is a soft wrap. Importing such a file with the app's hard-break
      // default would shred every wrapped paragraph, so pin the document to soft
      // breaks up front — the author can still flip it back per document.
      const docConfig = docType === Memo_DocType.MARKDOWN ? create(DocConfigSchema, { softBreak: true }) : undefined;
      await handleCreateDocument(folderPath, stripExtension(file.name), docType, content, docConfig);
    },
    [handleCreateDocument],
  );

  const handleUploadPdf = useCallback(
    async (folderPath: string, file: File) => {
      if (!workspaceName) return;
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const attachment = await createAttachment.mutateAsync({
          attachment: create(AttachmentSchema, {
            filename: file.name,
            size: BigInt(file.size),
            type: file.type || "application/pdf",
            content: buffer,
            origin: AttachmentOrigin.MOUNTED,
          }),
          workspace: workspaceName,
        });
        const created = await createMemo.mutateAsync(
          create(MemoSchema, {
            workspace: workspaceName,
            folderPath,
            title: stripExtension(file.name),
            docType: Memo_DocType.PDF,
            content: "",
            attachments: [create(AttachmentSchema, { name: attachment.name })],
          }),
        );
        invalidateTree();
        setSelectedMemo(created.name);
      } catch (error) {
        handleError(error, toast.error, { context: t("notebook.upload-pdf") });
      }
    },
    [workspaceName, createAttachment, createMemo, invalidateTree, t],
  );

  const handleNewFolder = useCallback(
    async (parentPath: string, name: string) => {
      if (!workspaceName) return;
      const path = parentPath ? `${parentPath}/${name}` : name;
      try {
        await createFolder.mutateAsync({ parent: workspaceName, path });
      } catch (error) {
        handleError(error, toast.error, { context: t("notebook.new-folder") });
      }
    },
    [workspaceName, createFolder, t],
  );

  const handleRenameFolder = useCallback(
    async (oldPath: string, newName: string) => {
      if (!workspaceName) return;
      const parentSegments = oldPath.split("/").slice(0, -1);
      const newPath = [...parentSegments, newName].join("/");
      try {
        await renameFolder.mutateAsync({
          parent: workspaceName,
          oldPath,
          newPath,
        });
        invalidateTree();
      } catch (error) {
        handleError(error, toast.error, { context: t("common.rename") });
      }
    },
    [workspaceName, renameFolder, invalidateTree, t],
  );

  const handleMoveFolder = useCallback(
    async (oldPath: string, destinationWorkspace: string, destinationFolderPath: string) => {
      if (!workspaceName) return;
      try {
        // Within one workspace a move is just a path rewrite; across workspaces the
        // documents have to change owner too, which is a separate RPC.
        if (destinationWorkspace === workspaceName) {
          const name = oldPath.split("/").pop() ?? oldPath;
          const newPath = destinationFolderPath ? `${destinationFolderPath}/${name}` : name;
          await renameFolder.mutateAsync({ parent: workspaceName, oldPath, newPath });
        } else {
          await moveFolder.mutateAsync({
            parent: workspaceName,
            path: oldPath,
            destinationWorkspace,
            destinationFolderPath,
          });
        }
        invalidateTree();
      } catch (error) {
        handleError(error, toast.error, { context: t("notebook.move") });
      }
    },
    [workspaceName, renameFolder, moveFolder, invalidateTree, t],
  );

  const handleDeleteFolder = useCallback(
    async (path: string) => {
      if (!workspaceName) return;
      if (!window.confirm(t("notebook.delete-folder-confirm"))) return;
      try {
        await deleteFolder.mutateAsync({ parent: workspaceName, path });
      } catch (error) {
        handleError(error, toast.error, { context: t("common.delete") });
      }
    },
    [workspaceName, deleteFolder, t],
  );

  const handleRename = useCallback(
    async (title: string) => {
      if (!memo) return;
      await updateMemo.mutateAsync({
        update: { name: memo.name, title },
        updateMask: ["title"],
      });
      invalidateTree();
    },
    [memo, updateMemo, invalidateTree],
  );

  const handleArchiveToggle = useCallback(async () => {
    if (!memo) return;
    const nextState = memo.state === State.ARCHIVED ? State.NORMAL : State.ARCHIVED;
    await updateMemo.mutateAsync({
      update: { name: memo.name, state: nextState },
      updateMask: ["state"],
    });
    invalidateTree();
  }, [memo, updateMemo, invalidateTree]);

  const handleDelete = useCallback(async () => {
    if (!memo) return;
    if (!window.confirm(t("memo.delete-confirm"))) return;
    await deleteMemo.mutateAsync(memo.name);
    invalidateTree();
    setSelectedMemo(undefined);
  }, [memo, deleteMemo, invalidateTree, t]);

  const handleSaveHtml = useCallback(
    async (content: string) => {
      if (!memo) return;
      await updateMemo.mutateAsync({
        update: { name: memo.name, content },
        updateMask: ["content"],
      });
      toast.success(t("common.save"));
    },
    [memo, updateMemo, t],
  );

  // Mounts uploaded files onto the current document as attachments (appended to
  // any existing ones). Used by VIEW documents to attach files at the bottom.
  const handleAddAttachments = useCallback(
    async (files: File[]) => {
      if (!memo || files.length === 0) return;
      try {
        const created = await Promise.all(
          files.map(async (file) =>
            createAttachment.mutateAsync({
              attachment: create(AttachmentSchema, {
                filename: file.name,
                size: BigInt(file.size),
                type: file.type || "application/octet-stream",
                content: new Uint8Array(await file.arrayBuffer()),
                origin: AttachmentOrigin.MOUNTED,
              }),
              workspace: memo.workspace,
            }),
          ),
        );
        const attachments = [...memo.attachments, ...created].map((a) => create(AttachmentSchema, { name: a.name }));
        await updateMemo.mutateAsync({
          update: { name: memo.name, attachments },
          updateMask: ["attachments"],
        });
        invalidateTree();
      } catch (error) {
        handleError(error, toast.error, { context: t("gallery.add-attachment") });
      }
    },
    [memo, createAttachment, updateMemo, invalidateTree, t],
  );

  const handleRemoveAttachment = useCallback(
    async (name: string) => {
      if (!memo) return;
      const attachments = memo.attachments.filter((a) => a.name !== name).map((a) => create(AttachmentSchema, { name: a.name }));
      await updateMemo.mutateAsync({
        update: { name: memo.name, attachments },
        updateMask: ["attachments"],
      });
      invalidateTree();
    },
    [memo, updateMemo, invalidateTree],
  );

  const handleMove = useCallback(
    async (memoName: string, workspace: string, folderPath: string) => {
      await updateMemo.mutateAsync({
        update: { name: memoName, workspace, folderPath },
        updateMask: ["workspace", "folder_path"],
      });
      invalidateTree();
      if (workspace !== workspaceName) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, false) });
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, true) });
        if (memoName === selectedMemo) setSelectedMemo(undefined);
      }
      toast.success(t("common.save"));
    },
    [updateMemo, invalidateTree, workspaceName, selectedMemo, queryClient, t],
  );

  const handleCopyDocumentLink = useCallback(
    (memoName: string) => {
      const host = profile.instanceUrl || window.location.origin;
      copy(`${host}/${memoName}`);
      toast.success(t("message.succeed-copy-link"));
    },
    [profile.instanceUrl, t],
  );

  // The tree only carries names, so the content is fetched on demand for the row that was clicked.
  const handleCopyDocumentContent = useCallback(
    async (memoName: string) => {
      try {
        const target = await memoServiceClient.getMemo({ name: memoName });
        copy(target.content);
        toast.success(t("message.succeed-copy-content"));
      } catch (error) {
        handleError(error, toast.error);
      }
    },
    [t],
  );

  return (
    <div className="w-full h-svh flex flex-row">
      {!effectiveSidebarCollapsed && (
        <div className="w-72 shrink-0 h-full border-r border-border">
          <NotebookSidebar
            workspaces={workspaces}
            workspaceName={workspaceName}
            onWorkspaceChange={handleWorkspaceChange}
            tree={tree}
            selectedMemo={selectedMemo}
            onSelectDocument={handleSelectDocument}
            onOpenDocumentInNewTab={handleOpenDocumentInNewTab}
            onMoveDocument={(memoName) => setMoveDocDialog({ memoName })}
            onCopyDocumentLink={handleCopyDocumentLink}
            onCopyDocumentContent={handleCopyDocumentContent}
            onOpenInNewTab={handleOpenInNewTab}
            archived={archived}
            onArchivedChange={setArchived}
            onNewDocument={(folderPath) => setNewDocDialog({ folderPath })}
            onNewView={(folderPath) => setNewViewDialog({ folderPath })}
            onNewBlogView={(folderPath) => setNewBlogViewDialog({ folderPath })}
            onNewFolder={(folderPath) => setNewFolderDialog({ folderPath })}
            onUpload={handleUpload}
            onUploadPdf={handleUploadPdf}
            onRenameFolder={(path) => setRenameFolderDialog({ path })}
            onMoveFolder={(path) => setMoveFolderDialog({ path })}
            onDeleteFolder={handleDeleteFolder}
            onSearch={handleLibrarySearch}
            restrictToMemos={searchHitMemos}
          />
        </div>
      )}
      <div className="flex-1 min-w-0 h-full">
        {memo ? (
          <DocumentLinkProvider
            value={{
              resolve: (href) => resolveWorkspacePath(tree, href),
              navigate: (memoName, href) => handleSelectDocument(memoName, href),
              listDocuments: () => flattenWorkspaceDocuments(tree, memo.name),
            }}
          >
            <EmbedAncestryProvider ancestry={[memo.name]}>
              <DocumentView
                memo={memo}
                onSaved={() => {
                  invalidateTree();
                }}
                onRenamed={handleRename}
                onArchiveToggle={handleArchiveToggle}
                onDelete={handleDelete}
                onSaveHtml={handleSaveHtml}
                onAddAttachments={handleAddAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                onOpenDocument={handleSelectDocument}
              />
            </EmbedAncestryProvider>
          </DocumentLinkProvider>
        ) : search ? (
          <LibrarySearchResults
            query={search.query}
            hits={search.hits}
            degradedToKeyword={search.degraded}
            loading={searchLoading}
            onSelect={handleSelectDocument}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            {tree.length === 0 ? t("notebook.no-documents") : t("notebook.select-a-document")}
          </div>
        )}
      </div>

      <PromptDialog
        open={!!newDocDialog}
        onOpenChange={(open) => !open && setNewDocDialog(null)}
        title={t("notebook.new-document")}
        placeholder={t("notebook.document-title-placeholder")}
        onConfirm={(title) => handleCreateDocument(newDocDialog?.folderPath ?? "", title)}
      />
      <PromptDialog
        open={!!newViewDialog}
        onOpenChange={(open) => !open && setNewViewDialog(null)}
        title={t("notebook.new-view")}
        placeholder={t("notebook.document-title-placeholder")}
        onConfirm={(title) => handleCreateDocument(newViewDialog?.folderPath ?? "", title, Memo_DocType.VIEW, "")}
      />
      <PromptDialog
        open={!!newBlogViewDialog}
        onOpenChange={(open) => !open && setNewBlogViewDialog(null)}
        title={t("notebook.new-blogview")}
        placeholder={t("notebook.document-title-placeholder")}
        onConfirm={(title) => handleCreateDocument(newBlogViewDialog?.folderPath ?? "", title, Memo_DocType.BLOGVIEW, NEW_SITE_HOME_LAYOUT)}
      />
      <PromptDialog
        open={!!newFolderDialog}
        onOpenChange={(open) => !open && setNewFolderDialog(null)}
        title={t("notebook.new-folder")}
        placeholder={t("notebook.folder-name-placeholder")}
        onConfirm={(name) => handleNewFolder(newFolderDialog?.folderPath ?? "", name)}
      />
      <PromptDialog
        open={!!renameFolderDialog}
        onOpenChange={(open) => !open && setRenameFolderDialog(null)}
        title={t("common.rename")}
        defaultValue={renameFolderDialog?.path.split("/").pop()}
        onConfirm={(name) => handleRenameFolder(renameFolderDialog?.path ?? "", name)}
      />
      {workspaceName && (
        <MoveDocumentDialog
          open={!!moveDocDialog}
          onOpenChange={(open) => !open && setMoveDocDialog(null)}
          currentWorkspace={workspaceName}
          onConfirm={(workspace, folderPath) => handleMove(moveDocDialog?.memoName ?? "", workspace, folderPath)}
        />
      )}
      {workspaceName && (
        <MoveFolderDialog
          open={!!moveFolderDialog}
          onOpenChange={(open) => !open && setMoveFolderDialog(null)}
          workspaceName={workspaceName}
          path={moveFolderDialog?.path ?? ""}
          onConfirm={(workspace, destinationFolderPath) => handleMoveFolder(moveFolderDialog?.path ?? "", workspace, destinationFolderPath)}
        />
      )}
    </div>
  );
};

export default Notebook;
