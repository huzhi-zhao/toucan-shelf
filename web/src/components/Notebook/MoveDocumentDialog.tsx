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
  currentWorkspace: string;
  onConfirm: (workspace: string, folderPath: string) => void | Promise<void>;
}

// Lets the user pick a destination workspace + folder path for an existing document,
// defaulting to the document's current workspace.
const MoveDocumentDialog = ({ open, onOpenChange, currentWorkspace, onConfirm }: Props) => {
  const t = useTranslate();
  const { data: workspaces = [] } = useWorkspaces();
  const [workspace, setWorkspace] = useState(currentWorkspace);
  const [folderPath, setFolderPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { data: tree = [] } = useWorkspaceTree(workspace, false);

  useEffect(() => {
    if (open) {
      setWorkspace(currentWorkspace);
      setFolderPath("");
    }
  }, [open, currentWorkspace]);

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
            <FolderTreePicker nodes={tree} value={folderPath} onChange={setFolderPath} rootLabel={t("notebook.workspace-root")} />
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
