import { timestampDate } from "@bufbuild/protobuf/wkt";
import copy from "copy-to-clipboard";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  ExpandIcon,
  FileTextIcon,
  FolderInputIcon,
  HistoryIcon,
  LinkIcon,
  MessageCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PaperclipIcon,
  PencilIcon,
  SaveIcon,
  TrashIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { DocCommentSidebar } from "@/components/DocComments/DocCommentSidebar";
import { nearestHeadingAnchor, nearestHeadingAnchorForNode, scrollToHeading } from "@/components/DocComments/docAnchor";
import GalleryViewForm from "@/components/GalleryView/GalleryViewForm";
import GalleryViewRenderer from "@/components/GalleryView/GalleryViewRenderer";
import CreateVersionDialog from "@/components/MemoActionMenu/CreateVersionDialog";
import MemoContent from "@/components/MemoContent";
import MemoEditor from "@/components/MemoEditor";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { AttachmentListView } from "@/components/MemoMetadata";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
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
import { useCreateMemoHistory, useMemoHistories, useRestoreMemoHistory } from "@/hooks/useMemoHistoryQueries";
import { useInfiniteMemoComments } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type DocAnchor, type Memo, Memo_DocType, type MemoHistory } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl, partitionInlinedAttachments } from "@/utils/attachment";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { attachmentUIDsOf, hashMemoState } from "@/utils/memoState";
import { getDocScrollPosition, restoreScrollTopWhenReady, saveDocScrollPosition } from "@/utils/scrollPositionCache";
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
  onAddAttachments?: (files: File[]) => void | Promise<void>;
  onRemoveAttachment?: (name: string) => void | Promise<void>;
  onOpenDocument?: (memoName: string) => void;
}

// Notebook's markdown preview renders MemoContent directly, without the MemoViewContext
// that memo feed/detail views normally provide. Supply a minimal, writable context here so
// content components that read it (e.g. the calendar block's add-task button, task checkboxes)
// work inside Notebook too.
const buildPreviewContext = (memo: Memo): MemoViewContextValue => ({
  memo,
  creator: undefined,
  currentUser: undefined,
  parentPage: "/",
  cardWidth: 0,
  isArchived: memo.state === State.ARCHIVED,
  readonly: false,
  showBlurredContent: false,
  blurred: false,
  openEditor: () => {},
  toggleBlurVisibility: () => {},
  openPreview: () => {},
});

const DocumentView = ({
  memo,
  onSaved,
  onRenamed,
  onArchiveToggle,
  onDelete,
  onSaveHtml,
  onMove,
  onAddAttachments,
  onRemoveAttachment,
  onOpenDocument,
}: Props) => {
  const t = useTranslate();
  const { profile } = useInstance();
  const isDesktop = useMediaQuery("lg");
  const isHtml = memo.docType === Memo_DocType.HTML;
  const isPdf = memo.docType === Memo_DocType.PDF;
  const isView = memo.docType === Memo_DocType.VIEW;
  const pdfAttachment = isPdf ? memo.attachments.find((a) => a.type === "application/pdf") : undefined;
  const remainingAttachments = partitionInlinedAttachments(memo.attachments, memo.content).rest;
  // Comments are available for markdown/view docs (PDF has its own annotation sidebar; HTML is skipped).
  const supportsComments = !isPdf && !isHtml;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Floating "comment on selection" button: positioned at the current text selection in the
  // preview, carrying the heading anchor computed from where the selection starts.
  const [selectionPopover, setSelectionPopover] = useState<{ top: number; left: number; anchor: DocAnchor }>();
  // A bump-to-open request handed to the comment sidebar to start composing pre-anchored.
  const [composeRequest, setComposeRequest] = useState<{ anchor: DocAnchor; nonce: number }>();
  const {
    data: comments = [],
    hasNextPage: hasMoreComments,
    fetchNextPage: fetchMoreComments,
    isFetchingNextPage: isFetchingMoreComments,
    refetch: refetchComments,
  } = useInfiniteMemoComments(memo.name, { enabled: supportsComments });
  // Pull in every page so the panel's count and list are complete, not capped at the first page.
  useEffect(() => {
    if (hasMoreComments && !isFetchingMoreComments) fetchMoreComments();
  }, [hasMoreComments, isFetchingMoreComments, fetchMoreComments]);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => {
    const displayOutline = parseFrontmatter(memo.content).properties.find((p) => p.key === "displayOutline")?.value;
    return displayOutline === false || (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches);
  });
  const [htmlDraft, setHtmlDraft] = useState(memo.content);
  const [titleDraft, setTitleDraft] = useState(memo.title);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  // Lazily load versions only once the "view versions" submenu is opened.
  const [versionsMenuOpen, setVersionsMenuOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [pdfToolbarSlot, setPdfToolbarSlot] = useState<HTMLDivElement | null>(null);
  const saveScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Live editor draft, kept in sync while `mode === "edit"` so the outline reflects
  // headings as they're typed instead of only the last-saved `memo.content`.
  const [editDraftContent, setEditDraftContent] = useState<string | null>(null);
  const editorRef = useRef<EditorController>(null);
  // PDF pages cache is keyed by the attachment (so the same file resumes at the same
  // spot even if moved between memos); markdown scroll position is keyed by the memo
  // itself. Markdown additionally splits the key by mode, since editing (CodeMirror)
  // and preview (rendered markdown) scroll independently and shouldn't clobber each
  // other's last position. HTML/gallery docs aren't cached.
  const scrollCacheKey = isPdf ? pdfAttachment?.name : !isHtml && !isView ? `${memo.name}:${mode}` : undefined;
  const cachedPosition = scrollCacheKey ? getDocScrollPosition(scrollCacheKey) : undefined;
  const outlineContent = mode === "edit" && editDraftContent != null ? editDraftContent : memo.content;

  const { mutateAsync: createMemoHistory } = useCreateMemoHistory();
  const { mutateAsync: restoreMemoHistory } = useRestoreMemoHistory();
  const canManageVersions = memo.state !== State.ARCHIVED && !isView;
  const { data: histories = [] } = useMemoHistories(memo.name, { enabled: canManageVersions && versionsMenuOpen });

  const handleCreateVersion = async (displayName: string) => {
    try {
      await createMemoHistory({ memoName: memo.name, displayName });
      toast.success(t("memo.version-saved"));
    } catch {
      toast.error(t("memo.version-save-failed"));
    }
  };

  // Switches to a historical version (content + attachment set). Blocks only if
  // the memo's current state matches NO saved version — a memo sitting at an
  // older restored version is still safe (recoverable via its own history
  // record); only truly unsaved changes must be saved before switching. The
  // server re-checks the same condition as a backstop.
  const handleSwitchVersion = async (history: MemoHistory) => {
    const currentHash = await hashMemoState(memo.content, attachmentUIDsOf(memo));
    if (!histories.some((h) => h.contentHash === currentHash)) {
      toast.error(t("memo.switch-version-blocked"));
      return;
    }
    try {
      await restoreMemoHistory({ historyName: history.name, memoName: memo.name });
      onSaved();
      toast.success(t("memo.version-switched"));
    } catch {
      toast.error(t("memo.switch-version-blocked"));
    }
  };

  // Always land on preview first when switching documents (per spec), except
  // a freshly created view doc, which has no config yet and opens its form.
  useEffect(() => {
    setMode(isView && !memo.content.trim() ? "edit" : "preview");
    setCommentsOpen(false);
    setSelectionPopover(undefined);
    setHtmlDraft(memo.content);
    setTitleDraft(memo.title);
    setEditDraftContent(null);
    // `displayOutline: false` in frontmatter collapses the outline by default
    // when opening this document; otherwise fall back to the viewport check.
    const displayOutline = parseFrontmatter(memo.content).properties.find((p) => p.key === "displayOutline")?.value;
    setOutlineCollapsed(displayOutline === false || (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches));
  }, [memo.name]);

  const isArchived = memo.state === State.ARCHIVED;

  const handleCopyLink = () => {
    const host = profile.instanceUrl || window.location.origin;
    copy(`${host}/${memo.name}`);
    toast.success(t("message.succeed-copy-link"));
  };

  const handleOpenReader = () => {
    window.open(`/${memo.name}/reader`, "_blank", "noopener");
  };

  const handleCopyContent = () => {
    copy(memo.content);
    toast.success(t("message.succeed-copy-content"));
  };

  useEffect(() => {
    if (mode !== "edit") setEditDraftContent(null);
  }, [mode]);

  // Cache the editor's own scroll position (separate from the preview container's,
  // since edit mode swaps in CodeMirror instead of the rendered preview) while editing,
  // and restore it once the editor mounts for this document. Unlike PDF pages,
  // CodeMirror knows its full scroll height synchronously (no lazy-growing canvases),
  // so a single rAF after mount is enough for the restore to stick.
  useEffect(() => {
    if (mode !== "edit" || !scrollCacheKey) return;
    const editor = editorRef.current;
    if (!editor) return;
    let raf = 0;
    if (cachedPosition?.scrollTop != null) {
      const target = cachedPosition.scrollTop;
      raf = requestAnimationFrame(() => editor.setScrollTop(target));
    }
    const unsubscribe = editor.onScroll((top) => {
      clearTimeout(saveScrollTimeoutRef.current);
      saveScrollTimeoutRef.current = setTimeout(() => saveDocScrollPosition(scrollCacheKey, { scrollTop: top }), 300);
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scrollCacheKey]);

  const handlePreviewScroll = () => {
    // The selection popover is positioned in viewport coordinates, so it goes stale the moment
    // the preview scrolls — drop it rather than let it drift away from the selection.
    if (selectionPopover) setSelectionPopover(undefined);
    if (mode !== "preview" || !scrollCacheKey) return;
    const el = previewRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    clearTimeout(saveScrollTimeoutRef.current);
    saveScrollTimeoutRef.current = setTimeout(() => saveDocScrollPosition(scrollCacheKey, { scrollTop }), 300);
  };

  // On mouse-up in the preview, if the user has selected some text, capture the selection's
  // start node *now* (before a click elsewhere clears it), resolve the nearest heading above it,
  // and show a floating "comment on selection" button anchored to the selection's rect.
  const handlePreviewMouseUp = () => {
    // Selection-to-comment is only offered while the comment panel is open.
    if (!supportsComments || mode !== "preview" || !commentsOpen) return;
    const container = previewRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) {
      setSelectionPopover(undefined);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionPopover(undefined);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelectionPopover(undefined);
      return;
    }
    const anchor = nearestHeadingAnchorForNode(container, range.startContainer);
    setSelectionPopover({ top: rect.top - 8, left: rect.left + rect.width / 2, anchor });
  };

  // Fired from the floating button: open the comments panel and start composing, pre-anchored
  // to the selection's section. The selection may clear as focus moves — the anchor is already
  // captured, so that's fine.
  const composeFromSelection = () => {
    if (!selectionPopover) return;
    setOutlineCollapsed(true);
    setCommentsOpen(true);
    setComposeRequest({ anchor: selectionPopover.anchor, nonce: Date.now() });
    setSelectionPopover(undefined);
  };

  // Restore the cached scroll position (markdown preview, or continuous-scroll PDF mode)
  // once the switch to this document/mode has settled and content has laid out.
  useEffect(() => {
    if (mode !== "preview" || !scrollCacheKey || cachedPosition?.scrollTop == null) return;
    const el = previewRef.current;
    if (!el) return;
    return restoreScrollTopWhenReady(el, cachedPosition.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scrollCacheKey]);

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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const next = !outlineCollapsed;
                setOutlineCollapsed(next);
                // Outline and comments share the right dock — opening one closes the other.
                if (!next) setCommentsOpen(false);
              }}
              title={t("notebook.toggle-outline")}
            >
              {outlineCollapsed ? <PanelRightOpenIcon className="w-4 h-4" /> : <PanelRightCloseIcon className="w-4 h-4" />}
            </Button>
          )}
          {isPdf && <div ref={setPdfToolbarSlot} className="flex items-center" />}
          {supportsComments && (
            <Button
              variant={commentsOpen ? "secondary" : "ghost"}
              size="icon"
              onClick={() => {
                const next = !commentsOpen;
                setCommentsOpen(next);
                // Outline and comments share the right dock — opening one closes the other.
                if (next) setOutlineCollapsed(true);
                // Closing the panel also disables selection-to-comment, so drop any stale popover.
                else setSelectionPopover(undefined);
              }}
              title={t("memo.comment.self")}
            >
              <MessageCircleIcon className="w-4 h-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <span className="sr-only">menu</span>⋮
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Bare reader in a new tab — also the entry point for printing to PDF.
                  Mirrors the same item in MemoActionMenu, which this toolbar predates. */}
              <DropdownMenuItem onClick={handleOpenReader}>
                <ExpandIcon className="w-4 h-4 mr-2" />
                {t("memo.fullscreen-view")}
              </DropdownMenuItem>
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
              {canManageVersions && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <HistoryIcon className="w-4 h-4 mr-2" />
                    {t("memo.version-history")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setCreateVersionDialogOpen(true)}>
                      <SaveIcon className="w-4 h-4 mr-2" />
                      {t("memo.create-as-version")}
                    </DropdownMenuItem>
                    <DropdownMenuSub onOpenChange={setVersionsMenuOpen}>
                      <DropdownMenuSubTrigger>
                        <HistoryIcon className="w-4 h-4 mr-2" />
                        {t("memo.view-versions")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                        {histories.length === 0 ? (
                          <DropdownMenuItem disabled>{t("memo.no-versions")}</DropdownMenuItem>
                        ) : (
                          histories.map((history) => (
                            <DropdownMenuItem key={history.name} onClick={() => handleSwitchVersion(history)}>
                              <div className="flex flex-col">
                                <span className="text-sm">{history.displayName || t("memo.unnamed-version")}</span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  {history.createTime && timestampDate(history.createTime).toLocaleString()}
                                  {history.attachments.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5">
                                      <PaperclipIcon className="w-3 h-3" />
                                      {history.attachments.length}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
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

      <CreateVersionDialog open={createVersionDialogOpen} onOpenChange={setCreateVersionDialogOpen} onConfirm={handleCreateVersion} />

      <div className="flex-1 min-h-0 flex">
        <div
          className={cn("flex-1 min-w-0", mode === "edit" ? "overflow-hidden" : "overflow-y-auto")}
          ref={previewRef}
          onScroll={handlePreviewScroll}
          onMouseUp={handlePreviewMouseUp}
        >
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
                initialPageNumber={cachedPosition?.page}
                onPageNumberChange={(page) => pdfAttachment && saveDocScrollPosition(pdfAttachment.name, { page })}
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
              <div className="px-6 py-4">
                <GalleryViewRenderer memo={memo} onOpenDoc={onOpenDocument} />
                {remainingAttachments.length > 0 && (
                  <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                    <AttachmentListView attachments={remainingAttachments} />
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full">
                <GalleryViewForm
                  key={memo.name}
                  content={memo.content}
                  attachments={remainingAttachments}
                  onSave={(content) => {
                    onSaveHtml(content);
                    setMode("preview");
                  }}
                  onCancel={() => setMode("preview")}
                  onAddAttachments={onAddAttachments}
                  onRemoveAttachment={onRemoveAttachment}
                />
              </div>
            )
          ) : mode === "preview" ? (
            <div className="px-6 py-4">
              <MemoViewContext.Provider value={buildPreviewContext(memo)}>
                <MemoContent content={memo.content} memoName={memo.name} />
              </MemoViewContext.Provider>
              {remainingAttachments.length > 0 && (
                <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                  <AttachmentListView attachments={remainingAttachments} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col px-4 py-4">
              <MemoEditor
                ref={editorRef}
                key={memo.name}
                autoFocus
                expand
                cacheKey={`notebook-editor-${memo.name}`}
                memo={memo}
                onContentChange={setEditDraftContent}
                onConfirm={() => {
                  setMode("preview");
                  onSaved();
                }}
                onCancel={() => setMode("preview")}
              />
            </div>
          )}
        </div>
        {!isHtml && !isPdf && !isView && !outlineCollapsed && !commentsOpen && isDesktop && (
          <div className="w-56 shrink-0 min-h-0 border-l border-border flex flex-col px-2 py-3">
            <div className="text-xs font-medium text-muted-foreground px-2 pb-2 uppercase tracking-wide">{t("notebook.outline")}</div>
            <DocumentOutline
              content={outlineContent}
              containerRef={previewRef}
              hasAttachments={remainingAttachments.length > 0}
              isEditing={mode === "edit"}
              onScrollToLine={(line) => editorRef.current?.scrollToLine(line)}
            />
          </div>
        )}
        {supportsComments && commentsOpen && isDesktop && (
          <div className="w-72 shrink-0 min-h-0 border-l border-border">
            <DocCommentSidebar
              parentMemoName={memo.name}
              comments={comments}
              onClose={() => setCommentsOpen(false)}
              onChanged={refetchComments}
              getAnchor={() => nearestHeadingAnchor(previewRef.current)}
              onJump={(slug) => scrollToHeading(previewRef.current, slug)}
              composeRequest={composeRequest}
            />
          </div>
        )}
      </div>

      {supportsComments && commentsOpen && !isDesktop && (
        <Sheet open onOpenChange={(open) => !open && setCommentsOpen(false)}>
          <SheetContent side="right" className="w-[85%] max-w-full overflow-y-auto px-0 py-0 bg-background">
            <SheetHeader className="px-4 pt-4">
              <SheetTitle>{t("memo.comment.self")}</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100%-3.5rem)]">
              <DocCommentSidebar
                parentMemoName={memo.name}
                comments={comments}
                onChanged={refetchComments}
                getAnchor={() => nearestHeadingAnchor(previewRef.current)}
                onJump={(slug) => {
                  setCommentsOpen(false);
                  scrollToHeading(previewRef.current, slug);
                }}
                composeRequest={composeRequest}
                className="border-l-0 border-t-0"
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {!isHtml && !isPdf && !isView && !isDesktop && (
        <Sheet open={!outlineCollapsed} onOpenChange={(open) => setOutlineCollapsed(!open)}>
          <SheetContent side="right" className="w-[85%] max-w-full overflow-y-auto px-2 py-3 bg-background">
            <SheetHeader>
              <SheetTitle>{t("notebook.outline")}</SheetTitle>
            </SheetHeader>
            <DocumentOutline
              content={outlineContent}
              containerRef={previewRef}
              hasAttachments={remainingAttachments.length > 0}
              isEditing={mode === "edit"}
              onScrollToLine={(line) => editorRef.current?.scrollToLine(line)}
            />
          </SheetContent>
        </Sheet>
      )}

      {selectionPopover && commentsOpen && (
        <button
          type="button"
          style={{ position: "fixed", top: selectionPopover.top, left: selectionPopover.left, transform: "translate(-50%, -100%)" }}
          className="z-50 flex items-center gap-1 rounded-full border border-border bg-popover px-2.5 py-1 text-xs font-medium text-foreground shadow-md hover:bg-accent"
          // Fire before the click so the selection is still alive when we read it; also stop the
          // mousedown from clearing the selection before onClick runs.
          onMouseDown={(e) => {
            e.preventDefault();
            composeFromSelection();
          }}
        >
          <MessageCircleIcon className="w-3.5 h-3.5" />
          {t("memo.comment.write-a-comment")}
        </button>
      )}
    </div>
  );
};

export default DocumentView;
