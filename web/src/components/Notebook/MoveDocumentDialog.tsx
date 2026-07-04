import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceTree, useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

// Radix Select forbids an empty-string item value (reserved to clear the selection), so the
// workspace root is represented with this sentinel and translated back to "" on submit.
const ROOT_VALUE = "__root__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWorkspace: string;
  onConfirm: (workspace: string, folderPath: string) => void | Promise<void>;
}

// Flattens the folder tree into a list of selectable folder paths, root first.
function collectFolderPaths(nodes: import("@/types/proto/api/v1/workspace_service_pb").WorkspaceTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.FOLDER) {
      paths.push(node.path);
      paths.push(...collectFolderPaths(node.children));
    }
  }
  return paths;
}

// Lets the user pick a destination workspace + folder path for an existing document,
// defaulting to the document's current workspace.
const MoveDocumentDialog = ({ open, onOpenChange, currentWorkspace, onConfirm }: Props) => {
  const t = useTranslate();
  const { data: workspaces = [] } = useWorkspaces();
  const [workspace, setWorkspace] = useState(currentWorkspace);
  const [folderPath, setFolderPath] = useState(ROOT_VALUE);
  const [submitting, setSubmitting] = useState(false);
  const { data: tree = [] } = useWorkspaceTree(workspace, false);

  useEffect(() => {
    if (open) {
      setWorkspace(currentWorkspace);
      setFolderPath(ROOT_VALUE);
    }
  }, [open, currentWorkspace]);

  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);

  const handleWorkspaceChange = (name: string) => {
    setWorkspace(name);
    setFolderPath(ROOT_VALUE);
  };

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(workspace, folderPath === ROOT_VALUE ? "" : folderPath);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("notebook.move-document")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{t("notebook.destination-workspace")}</div>
            <Select value={workspace} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.name} value={w.name}>
                    {w.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{t("notebook.destination-folder")}</div>
            <Select value={folderPath} onValueChange={setFolderPath}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>{t("notebook.workspace-root")}</SelectItem>
                {folderPaths.map((path) => (
                  <SelectItem key={path} value={path}>
                    {path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={submitting || !workspace} onClick={handleConfirm}>
            {t("notebook.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MoveDocumentDialog;
