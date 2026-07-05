import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useLocation } from "react-router-dom";
import DocumentView from "@/components/Notebook/DocumentView";
import NotebookSidebar from "@/components/Notebook/NotebookSidebar";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { useCreateAttachment } from "@/hooks/useAttachmentQueries";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLastOpened } from "@/hooks/useLastOpened";
import { useCreateMemo, useDeleteMemo, useMemo as useMemoDetail, useUpdateMemo } from "@/hooks/useMemoQueries";
import useNotebookSidebarCollapsed from "@/hooks/useNotebookSidebarCollapsed";
import {
  useCreateWorkspaceFolder,
  useDeleteWorkspaceFolder,
  useRenameWorkspaceFolder,
  useWorkspaces,
  useWorkspaceTree,
  workspaceKeys,
} from "@/hooks/useWorkspaceQueries";
import { handleError } from "@/lib/error";
import { AttachmentOrigin, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo_DocType, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

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

const Notebook = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: workspaces = [] } = useWorkspaces();
  const sidebarCollapsed = useNotebookSidebarCollapsed();
  const { getLastOpened, setLastOpened } = useLastOpened(currentUser?.name);
  const requestedWorkspace = (location.state as { workspace?: string } | null)?.workspace;

  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [selectedMemo, setSelectedMemo] = useState<string | undefined>(undefined);
  const [archived, setArchived] = useState(false);
  const restoredWorkspace = useRef(false);
  const restoredMemo = useRef(false);

  const [newDocDialog, setNewDocDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [newFolderDialog, setNewFolderDialog] = useState<{
    folderPath: string;
  } | null>(null);
  const [renameFolderDialog, setRenameFolderDialog] = useState<{
    path: string;
  } | null>(null);

  const { data: tree = [] } = useWorkspaceTree(workspaceName, archived);
  const { data: memo } = useMemoDetail(selectedMemo ?? "", {
    enabled: !!selectedMemo,
  });

  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const createAttachment = useCreateAttachment();
  const createFolder = useCreateWorkspaceFolder();
  const renameFolder = useRenameWorkspaceFolder();
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
    (async () => {
      const lastOpened = await getLastOpened();
      if (lastOpened && lastOpened.workspace === workspaceName && lastOpened.memo && containsMemo(tree, lastOpened.memo)) {
        setSelectedMemo(lastOpened.memo);
      } else {
        setSelectedMemo(findFirstDocument(tree));
      }
    })();
  }, [workspaceName, tree, getLastOpened]);

  useEffect(() => {
    if (workspaceName && selectedMemo) {
      setLastOpened(workspaceName, selectedMemo);
    }
  }, [workspaceName, selectedMemo, setLastOpened]);

  const handleWorkspaceChange = useCallback((name: string) => {
    setWorkspaceName(name);
    setSelectedMemo(undefined);
    restoredMemo.current = true; // don't re-restore memo on manual workspace switch
  }, []);

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
    async (folderPath: string, title: string, docType: Memo_DocType = Memo_DocType.MARKDOWN, content?: string) => {
      if (!workspaceName) return;
      try {
        const created = await createMemo.mutateAsync(
          create(MemoSchema, {
            workspace: workspaceName,
            folderPath,
            title,
            docType,
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
      await handleCreateDocument(folderPath, stripExtension(file.name), docType, content);
    },
    [handleCreateDocument],
  );

  const handleUploadPdf = useCallback(
    async (folderPath: string, file: File) => {
      if (!workspaceName) return;
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const attachment = await createAttachment.mutateAsync(
          create(AttachmentSchema, {
            filename: file.name,
            size: BigInt(file.size),
            type: file.type || "application/pdf",
            content: buffer,
            origin: AttachmentOrigin.MOUNTED,
          }),
        );
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

  const handleMove = useCallback(
    async (workspace: string, folderPath: string) => {
      if (!memo) return;
      await updateMemo.mutateAsync({
        update: { name: memo.name, workspace, folderPath },
        updateMask: ["workspace", "folder_path"],
      });
      invalidateTree();
      if (workspace !== workspaceName) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, false) });
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, true) });
        setSelectedMemo(undefined);
      }
      toast.success(t("common.save"));
    },
    [memo, updateMemo, invalidateTree, workspaceName, queryClient, t],
  );

  return (
    <div className="w-full h-svh flex flex-row">
      {!sidebarCollapsed && (
        <div className="w-72 shrink-0 h-full border-r border-border">
          <NotebookSidebar
            workspaces={workspaces}
            workspaceName={workspaceName}
            onWorkspaceChange={handleWorkspaceChange}
            tree={tree}
            selectedMemo={selectedMemo}
            onSelectDocument={setSelectedMemo}
            archived={archived}
            onArchivedChange={setArchived}
            onNewDocument={(folderPath) => setNewDocDialog({ folderPath })}
            onNewFolder={(folderPath) => setNewFolderDialog({ folderPath })}
            onUpload={handleUpload}
            onUploadPdf={handleUploadPdf}
            onRenameFolder={(path) => setRenameFolderDialog({ path })}
            onDeleteFolder={handleDeleteFolder}
          />
        </div>
      )}
      <div className="flex-1 min-w-0 h-full">
        {memo ? (
          <DocumentView
            memo={memo}
            onSaved={() => {
              invalidateTree();
            }}
            onRenamed={handleRename}
            onArchiveToggle={handleArchiveToggle}
            onDelete={handleDelete}
            onSaveHtml={handleSaveHtml}
            onMove={handleMove}
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
    </div>
  );
};

export default Notebook;
