import { LoaderCircleIcon } from "lucide-react";
import { forwardRef } from "react";
import { toast } from "react-hot-toast";
import { AttachmentOrigin } from "@/types/proto/api/v1/attachment_service_pb";
import { MAX_MEDIA_ATTACHMENT_SIZE_BYTES } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import Editor from "../Editor";
import { useBlobUrls, useDragAndDrop } from "../hooks";
import { buildMediaMarkdown, splitMediaFiles } from "../services/mediaInsertService";
import { uploadService } from "../services/uploadService";
import { useEditorContext, useEditorSelector } from "../state";
import type { EditorContentProps } from "../types";
import type { EditorController } from "../types/editorController";

// Imported eagerly (not React.lazy): the editor is the always-present compose
// box on the home route, which is already code-split — so deferring the
// CodeMirror bundle separately bought nothing and made the editor paint empty
// for a beat before its placeholder appeared (a visible flicker on load).

/**
 * Hosts the CodeMirror Editor behind the EditorController contract. The
 * editor serializes into state.content on every change and exposes its
 * formatting capability for the focus-mode toolbar.
 */
export const EditorContent = forwardRef<EditorController, EditorContentProps>(({ placeholder, expand }, ref) => {
  const t = useTranslate();
  const { actions, dispatch, getState } = useEditorContext();
  const { createBlobUrl } = useBlobUrls();
  const content = useEditorSelector((s) => s.content);
  const isFocusMode = useEditorSelector((s) => s.ui.isFocusMode);
  const isUploadingMedia = useEditorSelector((s) => s.ui.isLoading.uploading);

  // Pasted/dropped media files (image/video/audio) are uploaded immediately and
  // inlined into content as a markdown reference at the cursor, instead of going
  // through the batch-upload-on-save attachment flow. Non-media files still go
  // through addLocalFile and get uploaded on save like before.
  //
  // While a file is uploading, the editor is locked (readOnly, via ui.isLoading.uploading)
  // and a placeholder is inserted at the cursor, then swapped for the real markdown
  // reference once the upload resolves — this also prevents a second paste/drop from
  // racing the first and interleaving their insertions.
  const insertMediaFiles = async (files: File[]) => {
    const editor = (ref as React.RefObject<EditorController> | null)?.current;
    for (const file of files) {
      if (file.size > MAX_MEDIA_ATTACHMENT_SIZE_BYTES) {
        toast.error(t("editor.media-too-large"));
        continue;
      }
      const placeholder = `![${t("editor.media-uploading")}]()`;
      dispatch(actions.setLoading("uploading", true));
      editor?.insertMarkdown(placeholder);
      try {
        const [attachment] = await uploadService.uploadFiles([
          { file, previewUrl: createBlobUrl(file), origin: "upload", attachmentOrigin: AttachmentOrigin.INLINE },
        ]);
        dispatch(actions.setMetadata({ attachments: [...getState().metadata.attachments, attachment] }));
        editor?.replaceText(placeholder, buildMediaMarkdown(attachment));
      } catch {
        toast.error(t("editor.media-upload-error"));
        editor?.replaceText(placeholder, "");
      } finally {
        dispatch(actions.setLoading("uploading", false));
      }
    }
  };

  const handleIncomingFiles = (files: File[]) => {
    const { media, others } = splitMediaFiles(files);
    others.forEach((file) => {
      dispatch(actions.addLocalFile({ file, previewUrl: createBlobUrl(file), origin: "upload" }));
    });
    if (media.length > 0) {
      if (getState().ui.isLoading.uploading) {
        toast.error(t("editor.media-upload-in-progress"));
        return;
      }
      void insertMediaFiles(media);
    }
  };

  const { dragHandlers } = useDragAndDrop((files: FileList) => {
    handleIncomingFiles(Array.from(files));
  });

  const handleContentChange = (content: string) => {
    dispatch(actions.updateContent(content));
  };

  const handlePaste = (event: React.ClipboardEvent<Element>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const files: File[] = [];
    if (clipboard.items && clipboard.items.length > 0) {
      for (const item of Array.from(clipboard.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    } else if (clipboard.files && clipboard.files.length > 0) {
      files.push(...Array.from(clipboard.files));
    }

    if (files.length === 0) return;

    handleIncomingFiles(files);
    event.preventDefault();
  };

  return (
    <div className="w-full flex flex-col flex-1 min-h-0 relative" {...dragHandlers}>
      <Editor
        ref={ref}
        className="memo-editor-content"
        initialContent={content}
        placeholder={placeholder || ""}
        isFocusMode={isFocusMode}
        expand={expand}
        onContentChange={handleContentChange}
        onPaste={handlePaste}
        readOnly={isUploadingMedia}
      />
      {isUploadingMedia && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {t("editor.media-uploading")}
        </div>
      )}
    </div>
  );
});

EditorContent.displayName = "EditorContent";
