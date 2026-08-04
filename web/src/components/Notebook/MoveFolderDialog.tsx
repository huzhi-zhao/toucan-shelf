import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaces, useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { useTranslate } from "@/utils/i18n";
import FolderTreePicker from "./FolderTreePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  path: string;
  onConfirm: (workspace: string, destinationFolderPath: string) => void | Promise<void>;
}

// Lets the user pick a destination workspace + folder to move a folder (and its
// whole subtree) into, defaulting to the folder's current workspace.
const MoveFolderDialog = ({ open, onOpenChange, workspaceName, path, onConfirm }: Props) => {
  const t = useTranslate();
  const { data: workspaces = [] } = useWorkspaces();
  const [workspace, setWorkspace] = useState(workspaceName);
  const [folderPath, setFolderPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { data: tree = [] } = useWorkspaceTree(workspace, false);

  useEffect(() => {
    if (open) {
      setWorkspace(workspaceName);
      setFolderPath("");
    }
  }, [open, workspaceName]);

  const handleWorkspaceChange = (name: string) => {
    setWorkspace(name);
    setFolderPath("");
  };

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(workspace, folderPath);
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
            <FolderTreePicker
              nodes={tree}
              value={folderPath}
              onChange={setFolderPath}
              // A folder can only be its own ancestor within its own workspace; in
              // another workspace the same path is an unrelated folder.
              excludePath={workspace === workspaceName ? path : undefined}
              rootLabel={t("notebook.workspace-root")}
            />
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
