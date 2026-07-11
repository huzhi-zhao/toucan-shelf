import {
  ChevronRightIcon,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  node: WorkspaceTreeNode;
  depth: number;
  selectedMemo?: string;
  onSelectDocument: (memoName: string) => void;
  onRenameFolder: (path: string) => void;
  onMoveFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onNewDocumentIn: (path: string) => void;
  onNewViewIn: (path: string) => void;
  onNewFolderIn: (path: string) => void;
  onUploadIn: (path: string, file: File) => void;
  onUploadPdfIn: (path: string, file: File) => void;
}

const containsSelectedMemo = (node: WorkspaceTreeNode, selectedMemo: string): boolean => {
  if (node.type !== WorkspaceTreeNode_NodeType.FOLDER) {
    return node.memo === selectedMemo;
  }
  return node.children.some((child) => containsSelectedMemo(child, selectedMemo));
};

const FileTreeNode = ({
  node,
  depth,
  selectedMemo,
  onSelectDocument,
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
  const expanded = manualExpanded ?? ((depth === 0 && !selectedMemo) || containsSelected);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const isSelected = !isFolder && node.memo === selectedMemo;

  return (
    <div className="w-full">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1 py-1 text-sm cursor-pointer hover:bg-accent/60",
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
        <span className="truncate flex-1">{node.name}</span>
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
              <DropdownMenuItem onClick={() => onNewDocumentIn(node.path)}>{t("notebook.new-document")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNewViewIn(node.path)}>{t("notebook.new-view")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNewFolderIn(node.path)}>{t("notebook.new-folder")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>{t("notebook.upload-file")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => pdfInputRef.current?.click()}>{t("notebook.upload-pdf")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMoveFolder(node.path)}>{t("notebook.move")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRenameFolder(node.path)}>{t("common.rename")}</DropdownMenuItem>
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
              selectedMemo={selectedMemo}
              onSelectDocument={onSelectDocument}
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
