import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

// Radix Select forbids an empty-string item value (reserved to clear the selection), so the
// workspace root is represented with this sentinel and translated back to "" on submit.
const ROOT_VALUE = "__root__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  path: string;
  onConfirm: (destinationFolderPath: string) => void | Promise<void>;
}

// Flattens the folder tree into a list of selectable folder paths, excluding the folder
// being moved and any of its descendants (a folder cannot be moved into itself).
function collectFolderPaths(nodes: WorkspaceTreeNode[], excludePath: string): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === WorkspaceTreeNode_NodeType.FOLDER) {
      const isExcluded = node.path === excludePath || node.path.startsWith(`${excludePath}/`);
      if (!isExcluded) {
        paths.push(node.path);
        paths.push(...collectFolderPaths(node.children, excludePath));
      }
    }
  }
  return paths;
}

// Lets the user pick a destination folder (within the same workspace) to move a folder into.
const MoveFolderDialog = ({ open, onOpenChange, workspaceName, path, onConfirm }: Props) => {
  const t = useTranslate();
  const [folderPath, setFolderPath] = useState(ROOT_VALUE);
  const [submitting, setSubmitting] = useState(false);
  const { data: tree = [] } = useWorkspaceTree(workspaceName, false);

  useEffect(() => {
    if (open) {
      setFolderPath(ROOT_VALUE);
    }
  }, [open]);

  const folderPaths = useMemo(() => collectFolderPaths(tree, path), [tree, path]);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(folderPath === ROOT_VALUE ? "" : folderPath);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("notebook.move")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{t("notebook.destination-folder")}</div>
            <Select value={folderPath} onValueChange={setFolderPath}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>{t("notebook.workspace-root")}</SelectItem>
                {folderPaths.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
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
          <Button disabled={submitting} onClick={handleConfirm}>
            {t("notebook.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MoveFolderDialog;
