import { create } from "@bufbuild/protobuf";
import { useEffect, useRef, useState } from "react";
import { attachmentServiceClient } from "@/connect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUpdateWorkspace } from "@/hooks/useWorkspaceQueries";
import { AttachmentOrigin, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";

// Preset colors matching the book spine palette used on the bookshelf.
const COVER_COLOR_PRESETS = ["#0369a1", "#be123c", "#047857", "#b45309", "#6d28d9", "#0f766e"];

interface Props {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WorkspaceCoverColorDialog = ({ workspace, open, onOpenChange }: Props) => {
  const t = useTranslate();
  const updateWorkspace = useUpdateWorkspace();
  const [color, setColor] = useState(workspace.coverColor || COVER_COLOR_PRESETS[0]);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await updateWorkspace.mutateAsync({
        workspace: { ...workspace, coverColor: color },
        updateMask: ["cover_color"],
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("notebook.set-cover-color")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {COVER_COLOR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setColor(preset)}
              className={`w-8 h-8 rounded-full border-2 ${color === preset ? "border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: preset }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded-full overflow-hidden border border-border p-0 cursor-pointer"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={submitting} onClick={handleConfirm}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const WorkspaceCoverImageDialog = ({ workspace, open, onOpenChange }: Props) => {
  const t = useTranslate();
  const updateWorkspace = useUpdateWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState(workspace.coverImage || "");

  useEffect(() => {
    if (open) {
      setUrl(workspace.coverImage || "");
    }
  }, [open, workspace.coverImage]);

  const saveCoverImage = async (coverImage: string) => {
    try {
      setSubmitting(true);
      await updateWorkspace.mutateAsync({
        workspace: { ...workspace, coverImage },
        updateMask: ["cover_image"],
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    try {
      setSubmitting(true);
      const buffer = new Uint8Array(await file.arrayBuffer());
      const attachment = await attachmentServiceClient.createAttachment({
        attachment: create(AttachmentSchema, {
          filename: file.name,
          size: BigInt(file.size),
          type: file.type,
          content: buffer,
          origin: AttachmentOrigin.MOUNTED,
        }),
      });
      await updateWorkspace.mutateAsync({
        workspace: { ...workspace, coverImage: getAttachmentUrl(attachment) },
        updateMask: ["cover_image"],
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("notebook.set-cover-image")}</DialogTitle>
        </DialogHeader>
        {(url || workspace.coverImage) && (
          <div className="w-24 h-24 rounded-md overflow-hidden border border-border">
            <img src={url || workspace.coverImage} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <Input
          value={url}
          placeholder={t("notebook.cover-image-url-placeholder")}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) {
              e.preventDefault();
              saveCoverImage(url.trim());
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
        />
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
            {t("notebook.upload-file")}
          </Button>
          <Button disabled={submitting || !url.trim()} onClick={() => saveCoverImage(url.trim())}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
