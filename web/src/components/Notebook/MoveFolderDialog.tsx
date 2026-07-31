import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { useTranslate } from "@/utils/i18n";
import FolderTreePicker from "./FolderTreePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  path: string;
  onConfirm: (destinationFolderPath: string) => void | Promise<void>;
}

// Lets the user pick a destination folder (within the same workspace) to move a folder into.
const MoveFolderDialog = ({ open, onOpenChange, workspaceName, path, onConfirm }: Props) => {
  const t = useTranslate();
  const [folderPath, setFolderPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { data: tree = [] } = useWorkspaceTree(workspaceName, false);

  useEffect(() => {
    if (open) {
      setFolderPath("");
    }
  }, [open]);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm(folderPath);
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
            <FolderTreePicker
              nodes={tree}
              value={folderPath}
              onChange={setFolderPath}
              excludePath={path}
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
