import dayjs from "dayjs";
import { CalendarIcon, FilePlusIcon, FolderPlusIcon, SearchIcon, TagsIcon, UploadIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { calculateMaxCount, MonthCalendar } from "@/components/ActivityCalendar";
import { MonthNavigator } from "@/components/StatisticsView/MonthNavigator";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Workspace, WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
import FileTreeNode from "./FileTreeNode";
import WorkspaceSelector from "./WorkspaceSelector";

interface Props {
  workspaces: Workspace[];
  workspaceName?: string;
  onWorkspaceChange: (name: string) => void;
  tree: WorkspaceTreeNode[];
  selectedMemo?: string;
  onSelectDocument: (memoName: string) => void;
  archived: boolean;
  onArchivedChange: (archived: boolean) => void;
  onNewDocument: (folderPath: string) => void;
  onNewFolder: (folderPath: string) => void;
  onUpload: (folderPath: string, file: File) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
}

function filterTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  const walk = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT) {
      return node.name.toLowerCase().includes(q) ? node : null;
    }
    const children = node.children.map(walk).filter((n): n is WorkspaceTreeNode => n !== null);
    if (children.length > 0 || node.name.toLowerCase().includes(q)) {
      return { ...node, children };
    }
    return null;
  };
  return nodes.map(walk).filter((n): n is WorkspaceTreeNode => n !== null);
}

function collectDocDates(nodes: WorkspaceTreeNode[], acc: Map<string, number>) {
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT && node.createTime) {
      const date = new Date(Number(node.createTime.seconds) * 1000);
      const key = date.toISOString().slice(0, 10);
      acc.set(key, (acc.get(key) ?? 0) + 1);
    } else if (node.children.length > 0) {
      collectDocDates(node.children, acc);
    }
  }
}

function filterTreeByDate(nodes: WorkspaceTreeNode[], dateKey: string): WorkspaceTreeNode[] {
  const walk = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
    if (node.type === WorkspaceTreeNode_NodeType.DOCUMENT) {
      if (!node.createTime) return null;
      const key = new Date(Number(node.createTime.seconds) * 1000).toISOString().slice(0, 10);
      return key === dateKey ? node : null;
    }
    const children = node.children.map(walk).filter((n): n is WorkspaceTreeNode => n !== null);
    return children.length > 0 ? { ...node, children } : null;
  };
  return nodes.map(walk).filter((n): n is WorkspaceTreeNode => n !== null);
}

const NotebookSidebar = ({
  workspaces,
  workspaceName,
  onWorkspaceChange,
  tree,
  selectedMemo,
  onSelectDocument,
  archived,
  onArchivedChange,
  onNewDocument,
  onNewFolder,
  onUpload,
  onRenameFolder,
  onDeleteFolder,
}: Props) => {
  const t = useTranslate();
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string | undefined>(undefined);
  const [bottomPanel, setBottomPanel] = useState<"none" | "calendar" | "tags">("none");
  const [visibleMonth, setVisibleMonth] = useState(dayjs().format("YYYY-MM"));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const docDates = useMemo(() => {
    const acc = new Map<string, number>();
    collectDocDates(tree, acc);
    return acc;
  }, [tree]);

  const docDatesRecord = useMemo(() => Object.fromEntries(docDates), [docDates]);

  const visibleTree = useMemo(() => {
    let nodes = filterTree(tree, query);
    if (dateFilter) nodes = filterTreeByDate(nodes, dateFilter);
    return nodes;
  }, [tree, query, dateFilter]);

  return (
    <div className="w-full h-full flex flex-col gap-2 px-3 py-4">
      <WorkspaceSelector workspaces={workspaces} value={workspaceName} onChange={onWorkspaceChange} onCreated={onWorkspaceChange} />

      <div className="w-full flex items-center gap-1">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-50" />
          <input
            className="w-full text-sm bg-sidebar border border-border rounded-lg py-1.5 pl-7 pr-2 outline-0"
            placeholder={t("notebook.search-documents")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <FilePlusIcon className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onNewDocument("")}>
              <FilePlusIcon className="w-4 h-4 mr-2" />
              {t("notebook.new-document")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNewFolder("")}>
              <FolderPlusIcon className="w-4 h-4 mr-2" />
              {t("notebook.new-folder")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <UploadIcon className="w-4 h-4 mr-2" />
              {t("notebook.upload-file")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.html,.htm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload("", file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibleTree.length === 0 ? (
          <div className="text-sm text-muted-foreground px-2 py-6 text-center">{t("notebook.no-documents")}</div>
        ) : (
          visibleTree.map((node) => (
            <FileTreeNode
              key={`${node.type}-${node.path}`}
              node={node}
              depth={0}
              selectedMemo={selectedMemo}
              onSelectDocument={onSelectDocument}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onNewDocumentIn={onNewDocument}
              onNewFolderIn={onNewFolder}
            />
          ))
        )}
      </div>

      {dateFilter && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-1"
          onClick={() => setDateFilter(undefined)}
        >
          <CalendarIcon className="w-3 h-3" />
          {dateFilter} × {t("common.clear")}
        </button>
      )}

      <div className="shrink-0 border-t border-border pt-2">
        {bottomPanel === "calendar" && (
          <div className="mb-2 animate-scale-in">
            <MonthNavigator
              visibleMonth={visibleMonth}
              onMonthChange={setVisibleMonth}
              activityStats={docDatesRecord}
              timeBasis="create_time"
            />
            <MonthCalendar
              month={visibleMonth}
              data={docDatesRecord}
              maxCount={calculateMaxCount(docDatesRecord)}
              selectedDate={dateFilter}
              onClick={(date) => setDateFilter((d) => (d === date ? undefined : date))}
              size="small"
            />
          </div>
        )}
        {bottomPanel === "tags" && <div className="text-xs text-muted-foreground px-2 py-2 mb-2">{t("notebook.tags-unavailable")}</div>}
        <div className="flex items-center gap-1">
          <Button
            variant={bottomPanel === "calendar" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 justify-start gap-1.5 h-7"
            onClick={() => setBottomPanel((p) => (p === "calendar" ? "none" : "calendar"))}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {t("common.calendar")}
          </Button>
          <Button
            variant={bottomPanel === "tags" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 justify-start gap-1.5 h-7"
            onClick={() => setBottomPanel((p) => (p === "tags" ? "none" : "tags"))}
          >
            <TagsIcon className="w-3.5 h-3.5" />
            {t("notebook.tags")}
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-t border-border pt-2 flex items-center gap-2">
        <Checkbox id="notebook-archived" checked={archived} onCheckedChange={(v) => onArchivedChange(Boolean(v))} />
        <Label htmlFor="notebook-archived" className={cn("text-sm cursor-pointer", archived && "text-primary")}>
          {t("notebook.show-archived-only")}
        </Label>
      </div>
    </div>
  );
};

export default NotebookSidebar;
