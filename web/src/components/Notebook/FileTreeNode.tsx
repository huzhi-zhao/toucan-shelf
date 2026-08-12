import copy from "copy-to-clipboard";
import dayjs from "dayjs";
import {
  ChevronRightIcon,
  CodeIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  LayoutGridIcon,
  LinkIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { FreshnessMap } from "./notebookFreshness";
import { freshnessClass, freshnessKey } from "./notebookFreshness";

interface Props {
  node: WorkspaceTreeNode;
  depth: number;
  // The workspace this tree belongs to: resource name ("workspaces/{uid}") and display title.
  // Only the copy-info action needs them.
  workspaceName?: string;
  workspaceTitle?: string;
  selectedMemo?: string;
  // Recency tints keyed by node; absent when the workspace has nothing recent to highlight.
  freshness?: FreshnessMap;
  onSelectDocument: (memoName: string) => void;
  onOpenDocumentInNewTab?: (memoName: string) => void;
  onMoveDocument?: (memoName: string) => void;
  onCopyDocumentLink?: (memoName: string) => void;
  onCopyDocumentContent?: (memoName: string) => void;
  onRenameFolder: (path: string) => void;
  onMoveFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onNewDocumentIn: (path: string) => void;
  onNewViewIn: (path: string) => void;
  onNewFolderIn: (path: string) => void;
  onUploadIn: (path: string, file: File) => void;
  onUploadPdfIn: (path: string, file: File) => void;
}

// Everything before the last segment of a workspace-relative path; "" for a top-level node.
const parentFolderPath = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

const containsSelectedMemo = (node: WorkspaceTreeNode, selectedMemo: string): boolean => {
  if (node.type !== WorkspaceTreeNode_NodeType.FOLDER) {
    return node.memo === selectedMemo;
  }
  return node.children.some((child) => containsSelectedMemo(child, selectedMemo));
};

const FileTreeNode = ({
  node,
  depth,
  workspaceName,
  workspaceTitle,
  selectedMemo,
  freshness,
  onSelectDocument,
  onOpenDocumentInNewTab,
  onMoveDocument,
  onCopyDocumentLink,
  onCopyDocumentContent,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onNewDocumentIn,
  onNewViewIn,
  onNewFolderIn,
  onUploadIn,
  onUploadPdfIn,
}: Props) => {
  const t = useTranslate();
  const isFolder = node.type === WorkspaceTreeNode_NodeType.FOLDER;
  const containsSelected = useMemo(
    () => isFolder && !!selectedMemo && containsSelectedMemo(node, selectedMemo),
    [isFolder, node, selectedMemo],
  );
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  // Drop any manual expand/collapse override whenever the opened document changes so the
  // tree re-syncs to the selection: expand exactly the ancestors of the opened doc and
  // collapse everything else. Without this, a stale manual toggle would stick and keep
  // non-ancestor folders open (or ancestor folders closed) after navigating.
  useEffect(() => {
    setManualExpanded(null);
  }, [selectedMemo]);
  const expanded = manualExpanded ?? ((depth === 0 && !selectedMemo) || containsSelected);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const isSelected = !isFolder && node.memo === selectedMemo;
  // node.path is already workspace-relative ("foldera/folderb"), which is exactly what a
  // reader needs to address the folder elsewhere. The leading "/" makes it explicit that the
  // path is anchored at the workspace root rather than relative to wherever it gets pasted.
  const handleCopyFolderPath = useCallback(() => {
    copy(`/${node.path}`);
    toast.success(t("message.succeed-copy-path"));
  }, [node.path, t]);
  // A document node's own path ends in its UID; the title is what identifies it everywhere a
  // path is typed (folder_path + title, the local memogit mirror), so swap the last segment.
  const handleCopyDocumentPath = useCallback(() => {
    const folderPath = parentFolderPath(node.path);
    copy(folderPath ? `/${folderPath}/${node.name}` : `/${node.name}`);
    toast.success(t("message.succeed-copy-path"));
  }, [node.path, node.name, t]);
  // Where this node lives, in the exact vocabulary the ToucanShelf MCP addresses documents with
  // (workspace resource name, folder_path, title, memo resource name) so an agent handed this
  // block can go straight to get_memo/update_memo instead of re-walking list_workspaces + tree.
  // Kept in English, and pairing every id with its human label so a stale id can be spotted.
  const handleCopyInfo = useCallback(() => {
    const folderPath = isFolder ? node.path : parentFolderPath(node.path);
    const lines = [
      isFolder
        ? "Use the toucanshelf MCP to work in the online knowledge base at the location below."
        : "Use the toucanshelf MCP to work on the document at the location below.",
      "",
      `ToucanShelf ${isFolder ? "folder" : "document"} location`,
      `workspace: "${workspaceTitle ?? ""}" (${workspaceName ?? ""})`,
      `folder_path: "${folderPath}"${folderPath ? "" : " (workspace root)"}`,
    ];
    if (!isFolder) {
      lines.push(`title: "${node.name}"`, `memo: ${node.memo}`);
    } else {
      lines.push(`folder name: "${node.name}"`);
    }
    lines.push("", "Read other related documents in this knowledge base when necessary.");
    copy(lines.join("\n"));
    toast.success(t("message.succeed-copy-info"));
  }, [workspaceName, workspaceTitle, isFolder, node.path, node.name, node.memo, t]);
  // The selected row already stands out through its background, so let it keep the accent
  // foreground rather than fighting the tint.
  const freshClass = isSelected ? undefined : freshnessClass(freshness?.get(freshnessKey(node)));
  const updatedTitle =
    !isFolder && freshness?.has(freshnessKey(node)) && node.updateTime
      ? dayjs(Number(node.updateTime.seconds) * 1000).format("YYYY-MM-DD HH:mm")
      : undefined;

  return (
    <div className="w-full">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1 py-1 text-sm cursor-pointer select-none hover:bg-accent/60",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => (isFolder ? setManualExpanded(!expanded) : onSelectDocument(node.memo))}
      >
        {isFolder ? (
          <ChevronRightIcon className={cn("w-3.5 h-3.5 shrink-0 transition-transform text-muted-foreground", expanded && "rotate-90")} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isFolder ? (
          expanded ? (
            <FolderOpenIcon className="w-4 h-4 shrink-0 text-primary/80" />
          ) : (
            <FolderIcon className="w-4 h-4 shrink-0 text-primary/80" />
          )
        ) : node.docType === "HTML" ? (
          <CodeIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : node.docType === "PDF" ? (
          <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : node.docType === "VIEW" ? (
          <LayoutGridIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileTextIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate flex-1", freshClass)} title={updatedTitle}>
          {node.name}
        </span>
        {!isFolder && onOpenDocumentInNewTab && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-5 h-5 opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onOpenDocumentInNewTab(node.memo)}>
                <ExternalLinkIcon className="w-4 h-4" />
                {t("notebook.open-in-new-tab")}
              </DropdownMenuItem>
              {onMoveDocument && (
                <DropdownMenuItem onClick={() => onMoveDocument(node.memo)}>
                  <FolderInputIcon className="w-4 h-4" />
                  {t("notebook.move")}
                </DropdownMenuItem>
              )}
              {/* Every copy variant lives behind one submenu so the row menu stays short. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("common.copy")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {onCopyDocumentLink && (
                    <DropdownMenuItem onClick={() => onCopyDocumentLink(node.memo)}>
                      <LinkIcon className="w-4 h-4" />
                      {t("memo.copy-link")}
                    </DropdownMenuItem>
                  )}
                  {onCopyDocumentContent && (
                    <DropdownMenuItem onClick={() => onCopyDocumentContent(node.memo)}>
                      <FileTextIcon className="w-4 h-4" />
                      {t("memo.copy-content")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleCopyDocumentPath}>{t("notebook.copy-path")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyInfo}>{t("notebook.copy-info")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-5 h-5 opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {/* Every action is grouped into a submenu by verb so the folder row menu stays short. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("common.new")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onNewDocumentIn(node.path)}>{t("notebook.new-document")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onNewViewIn(node.path)}>{t("notebook.new-view")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onNewFolderIn(node.path)}>{t("notebook.new-folder")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("notebook.upload")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>{t("notebook.upload-file")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => pdfInputRef.current?.click()}>{t("notebook.upload-pdf")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("common.update")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onMoveFolder(node.path)}>{t("notebook.move")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRenameFolder(node.path)}>{t("common.rename")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("common.copy")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleCopyFolderPath}>{t("notebook.copy-path")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyInfo}>{t("notebook.copy-info")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {/* 文件夹的 delete 保留在这里：服务端只允许删除空文件夹（非空会以 FailedPrecondition
                  拒绝），所以它不会带走任何文档内容或附件；而且文件夹没有归档这条退路，删除是清理
                  空目录的唯一手段。文档的 delete 则是不可恢复的，已经从菜单里去掉，见 DocumentView。 */}
              <DropdownMenuItem variant="destructive" onClick={() => onDeleteFolder(node.path)}>
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {isFolder && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.html,.htm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadIn(node.path, file);
              e.target.value = "";
            }}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadPdfIn(node.path, file);
              e.target.value = "";
            }}
          />
        </>
      )}
      {isFolder && expanded && node.children.length > 0 && (
        <div className="w-full">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.memo ? `document-${child.memo}` : `${child.type}-${child.path}`}
              node={child}
              depth={depth + 1}
              workspaceName={workspaceName}
              workspaceTitle={workspaceTitle}
              selectedMemo={selectedMemo}
              freshness={freshness}
              onSelectDocument={onSelectDocument}
              onOpenDocumentInNewTab={onOpenDocumentInNewTab}
              onMoveDocument={onMoveDocument}
              onCopyDocumentLink={onCopyDocumentLink}
              onCopyDocumentContent={onCopyDocumentContent}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
              onNewDocumentIn={onNewDocumentIn}
              onNewViewIn={onNewViewIn}
              onNewFolderIn={onNewFolderIn}
              onUploadIn={onUploadIn}
              onUploadPdfIn={onUploadPdfIn}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FileTreeNode;
