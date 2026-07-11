import copy from "copy-to-clipboard";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  FileTextIcon,
  FolderInputIcon,
  LinkIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import GalleryViewForm from "@/components/GalleryView/GalleryViewForm";
import GalleryViewRenderer from "@/components/GalleryView/GalleryViewRenderer";
import MemoContent from "@/components/MemoContent";
import MemoEditor from "@/components/MemoEditor";
import { AttachmentListView } from "@/components/MemoMetadata";
import { PdfDocumentView } from "@/components/PdfViewer/PdfDocumentView";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/contexts/InstanceContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl, partitionInlinedAttachments } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import DocumentOutline, { ATTACHMENTS_ANCHOR_ID } from "./DocumentOutline";
import MoveDocumentDialog from "./MoveDocumentDialog";

interface Props {
  memo: Memo;
  onSaved: () => void;
  onRenamed: (title: string) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onSaveHtml: (content: string) => void;
  onMove: (workspace: string, folderPath: string) => void | Promise<void>;
  onOpenDocument?: (memoName: string) => void;
}

const DocumentView = ({ memo, onSaved, onRenamed, onArchiveToggle, onDelete, onSaveHtml, onMove, onOpenDocument }: Props) => {
  const t = useTranslate();
  const { profile } = useInstance();
  const isDesktop = useMediaQuery("lg");
  const isHtml = memo.docType === Memo_DocType.HTML;
  const isPdf = memo.docType === Memo_DocType.PDF;
  const isView = memo.docType === Memo_DocType.VIEW;
  const pdfAttachment = isPdf ? memo.attachments.find((a) => a.type === "application/pdf") : undefined;
  const remainingAttachments = partitionInlinedAttachments(memo.attachments, memo.content).rest;
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches,
  );
  const [htmlDraft, setHtmlDraft] = useState(memo.content);
  const [titleDraft, setTitleDraft] = useState(memo.title);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [pdfToolbarSlot, setPdfToolbarSlot] = useState<HTMLDivElement | null>(null);

  // Always land on preview first when switching documents (per spec), except
  // a freshly created view doc, which has no config yet and opens its form.
  useEffect(() => {
    setMode(isView && !memo.content.trim() ? "edit" : "preview");
    setHtmlDraft(memo.content);
    setTitleDraft(memo.title);
  }, [memo.name]);

  const isArchived = memo.state === State.ARCHIVED;

  const handleCopyLink = () => {
    const host = profile.instanceUrl || window.location.origin;
    copy(`${host}/${memo.name}`);
    toast.success(t("message.succeed-copy-link"));
  };

  const handleCopyContent = () => {
    copy(memo.content);
    toast.success(t("message.succeed-copy-content"));
  };

  return (
    <div className="w-full h-full flex flex-col min-w-0">
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-4 py-1.5">
        <input
          className="flex-1 min-w-0 bg-transparent text-lg font-medium outline-0 truncate"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft.trim() && titleDraft !== memo.title) onRenamed(titleDraft.trim());
          }}
        />
        <div className="flex items-center gap-1 shrink-0">
          {!isPdf && (
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <Button
                variant={mode === "preview" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none h-6 px-2 text-xs"
                onClick={() => setMode("preview")}
              >
                {t("notebook.preview")}
              </Button>
              <Button
                variant={mode === "edit" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none h-6 px-2 text-xs"
                onClick={() => setMode("edit")}
              >
                <PencilIcon className="w-3 h-3 mr-1" />
                {t("notebook.edit")}
              </Button>
            </div>
          )}
          {isHtml && mode === "edit" && (
            <Button size="sm" onClick={() => onSaveHtml(htmlDraft)}>
              {t("common.save")}
            </Button>
          )}
          {!isHtml && !isPdf && !isView && (
            <Button variant="ghost" size="icon" onClick={() => setOutlineCollapsed((v) => !v)} title={t("notebook.toggle-outline")}>
              {outlineCollapsed ? <PanelRightOpenIcon className="w-4 h-4" /> : <PanelRightCloseIcon className="w-4 h-4" />}
            </Button>
          )}
          {isPdf && <div ref={setPdfToolbarSlot} className="flex items-center" />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <span className="sr-only">menu</span>⋮
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <CopyIcon className="w-4 h-4 mr-2" />
                  {t("common.copy")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleCopyLink}>
                    <LinkIcon className="w-4 h-4 mr-2" />
                    {t("memo.copy-link")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyContent}>
                    <FileTextIcon className="w-4 h-4 mr-2" />
                    {t("memo.copy-content")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => setMoveDialogOpen(true)}>
                <FolderInputIcon className="w-4 h-4 mr-2" />
                {t("notebook.move")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchiveToggle}>
                {isArchived ? <ArchiveRestoreIcon className="w-4 h-4 mr-2" /> : <ArchiveIcon className="w-4 h-4 mr-2" />}
                {isArchived ? t("notebook.unarchive") : t("common.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <TrashIcon className="w-4 h-4 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <MoveDocumentDialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen} currentWorkspace={memo.workspace} onConfirm={onMove} />

      <div className="flex-1 min-h-0 flex">
        <div className={cn("flex-1 min-w-0", mode === "edit" ? "overflow-hidden" : "overflow-y-auto")} ref={previewRef}>
          {isPdf ? (
            pdfAttachment &&
            pdfToolbarSlot && (
              <PdfDocumentView
                url={getAttachmentUrl(pdfAttachment)}
                toolbarSlot={pdfToolbarSlot}
                className="px-6 py-4"
                parentMemoName={memo.name}
                attachmentName={pdfAttachment.name}
                filename={pdfAttachment.filename}
              />
            )
          ) : isHtml ? (
            mode === "preview" ? (
              <iframe
                title={memo.title || memo.name}
                sandbox="allow-scripts allow-popups allow-forms"
                srcDoc={memo.content}
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <Textarea
                className="w-full h-full min-h-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
                value={htmlDraft}
                onChange={(e) => setHtmlDraft(e.target.value)}
              />
            )
          ) : isView ? (
            mode === "preview" ? (
              <GalleryViewRenderer memo={memo} onOpenDoc={onOpenDocument} className="px-6 py-4" />
            ) : (
              <div className="px-6 py-4">
                <GalleryViewForm
                  key={memo.name}
                  content={memo.content}
                  onSave={(content) => {
                    onSaveHtml(content);
                    setMode("preview");
                  }}
                  onCancel={() => setMode("preview")}
                />
              </div>
            )
          ) : mode === "preview" ? (
            <div className="px-6 py-4">
              <MemoContent content={memo.content} memoName={memo.name} />
              {remainingAttachments.length > 0 && (
                <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                  <AttachmentListView attachments={remainingAttachments} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col px-4 py-4">
              <MemoEditor
                key={memo.name}
                autoFocus
                expand
                cacheKey={`notebook-editor-${memo.name}`}
                memo={memo}
                onConfirm={() => {
                  setMode("preview");
                  onSaved();
                }}
                onCancel={() => setMode("preview")}
              />
            </div>
          )}
        </div>
        {!isHtml && !isPdf && !isView && !outlineCollapsed && isDesktop && (
          <div className="w-56 shrink-0 min-h-0 border-l border-border flex flex-col px-2 py-3">
            <div className="text-xs font-medium text-muted-foreground px-2 pb-2 uppercase tracking-wide">{t("notebook.outline")}</div>
            <DocumentOutline content={memo.content} containerRef={previewRef} hasAttachments={remainingAttachments.length > 0} />
          </div>
        )}
      </div>

      {!isHtml && !isPdf && !isView && !isDesktop && (
        <Sheet open={!outlineCollapsed} onOpenChange={(open) => setOutlineCollapsed(!open)}>
          <SheetContent side="right" className="w-[85%] max-w-full overflow-y-auto px-2 py-3 bg-background">
            <SheetHeader>
              <SheetTitle>{t("notebook.outline")}</SheetTitle>
            </SheetHeader>
            <DocumentOutline content={memo.content} containerRef={previewRef} hasAttachments={remainingAttachments.length > 0} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};

export default DocumentView;
