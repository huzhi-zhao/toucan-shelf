import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate } from "@bufbuild/protobuf/wkt";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { DocCommentSidebar } from "@/components/DocComments/DocCommentSidebar";
import { type DocMark, DocMarkLayer } from "@/components/DocComments/DocMarkLayer";
import { anchorTextQuote, buildSelectionAnchor, nearestHeadingAnchor, scrollToAnchor } from "@/components/DocComments/docAnchor";
import { MARK_LAYER_ATTR } from "@/components/DocComments/textAnchor";
import GalleryViewForm from "@/components/GalleryView/GalleryViewForm";
import GalleryViewRenderer from "@/components/GalleryView/GalleryViewRenderer";
import { MARK_TOOLBAR_ATTR, MarkToolbar } from "@/components/MarkToolbar";
import CreateVersionDialog from "@/components/MemoActionMenu/CreateVersionDialog";
import MemoContent from "@/components/MemoContent";
import MemoEditor from "@/components/MemoEditor";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { AttachmentListView } from "@/components/MemoMetadata";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
import { PdfDocumentView } from "@/components/PdfViewer/PdfDocumentView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { memoServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useCreateMemoHistory, useMemoHistories, useRestoreMemoHistory } from "@/hooks/useMemoHistoryQueries";
import { useInfiniteMemoComments } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type DocAnchor, type Memo, Memo_DocType, type MemoHistory, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl, partitionInlinedAttachments } from "@/utils/attachment";
import { parseFrontmatter } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { DEFAULT_MARK_COLOR } from "@/utils/markColors";
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
  // Text marks (highlight / underline) are a markdown-document affordance: gallery docs render
  // live data rather than prose, so there's nothing stable to mark there.
  const supportsMarks = supportsComments && !isView;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // The floating mark toolbar, shown over the current text selection in the preview. Its anchor
  // is captured up front (heading + text quote) because the selection itself is gone the moment
  // focus moves to the toolbar.
  const [selectionPopover, setSelectionPopover] = useState<{ top: number; left: number; anchor: DocAnchor }>();
  // The comment whose mark is currently emphasized — set by clicking a mark or a sidebar card.
  const [selectedMemoName, setSelectedMemoName] = useState<string>();
  // An existing mark that was clicked, with the toolbar open over it for restyling/clearing.
  const [activeMark, setActiveMark] = useState<{ memoName: string; x: number; y: number }>();
  // A bare mark being given a note, edited in a dialog over the document (the sidebar only lists
  // comments that already have one).
  const [editingMarkComment, setEditingMarkComment] = useState<Memo>();
  // Marks whose text no longer exists in the document (it was edited away). They stay in the
  // sidebar, flagged, rather than disappearing along with whatever note they carry.
  const [unresolvedMarks, setUnresolvedMarks] = useState<string[]>([]);
  // Where each mark currently sits, republished by the mark layer after every remeasure. The
  // mark toolbar reads its position from here rather than from the click that opened it, so it
  // stays over its mark when the click itself reflows the document (opening the comment panel
  // and collapsing the outline both change the text's width — very visibly on a wide screen,
  // where the outline is expanded to begin with).
  const [markAnchors, setMarkAnchors] = useState<Record<string, { x: number; y: number }>>({});
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
  // Comments carrying a pdf/epub annotation are anchored to an *attachment* (managed by the
  // PDF/EPUB reader's own annotation sidebar), not to this document's body — so keep them out
  // of the doc comment panel. Only doc-body comments (plain or heading-anchored) belong here.
  const docComments = useMemo(() => comments.filter((c) => !c.pdfAnnotation && !c.epubAnnotation), [comments]);
  // Every doc comment that carries a text quote also draws as an in-text mark. Comments anchored
  // only to a heading (or to nothing) contribute no mark and just live in the sidebar.
  const marks = useMemo<DocMark[]>(
    () =>
      docComments.flatMap((comment) => {
        const quote = anchorTextQuote(comment.docAnchor);
        if (!quote) return [];
        return [{ memoName: comment.name, quote, color: comment.docAnchor?.color ?? "", underline: comment.docAnchor?.underline ?? false }];
      }),
    [docComments],
  );
  const activeMarkComment = useMemo(() => docComments.find((c) => c.name === activeMark?.memoName), [docComments, activeMark]);
  // Only comments with something written in them belong in the panel; a bare mark is pure
  // styling on the text and would otherwise show up as an empty card.
  const notedComments = useMemo(() => docComments.filter((c) => c.content.trim()), [docComments]);
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
  // The rendered document itself, inside the scroll viewport. Marks are measured and positioned
  // against this element (not the viewport), so they scroll with the text for free.
  const markContainerRef = useRef<HTMLDivElement>(null);
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
    // Mark state belongs to the document that was open, not to the one being opened.
    setActiveMark(undefined);
    setSelectedMemoName(undefined);
    setUnresolvedMarks([]);
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
    // The mark toolbar is positioned inside the document element, so it scrolls along with the
    // selection it points at and doesn't need to be dismissed here.
    if (mode !== "preview" || !scrollCacheKey) return;
    const el = previewRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    clearTimeout(saveScrollTimeoutRef.current);
    saveScrollTimeoutRef.current = setTimeout(() => saveDocScrollPosition(scrollCacheKey, { scrollTop }), 300);
  };

  // Drops the current text selection. Used after a selection has been turned into a mark, so the
  // browser's selection highlight doesn't sit on top of the mark that replaced it.
  const clearSelection = () => window.getSelection()?.removeAllRanges();

  // On mouse-up in the preview, if the user has selected some text, capture the selection *now*
  // (before focus moves to the toolbar and clears it) as a full anchor — enclosing heading plus
  // a quote selector for the text — and show the mark toolbar over the selection's rect.
  const handlePreviewMouseUp = (event: React.MouseEvent) => {
    // Selecting to mark/comment is only offered while the comment panel is open.
    if (!supportsMarks || mode !== "preview" || !commentsOpen) return;
    // A mouse-up on an existing mark is a click on that mark, handled by the mark's own click
    // handler. It must not be read as a selection gesture: clicking inside text that is still
    // selected (the selection survives the toolbar, which prevents its own mouse-down) leaves
    // the old selection standing until after mouse-up, so this would re-open the "new mark"
    // toolbar over the stale selection and fight the mark toolbar for the same spot.
    // A mouse-up inside the toolbar itself must not dismiss it either — that would unmount it
    // before the click reaches the button being pressed, so every button would silently do
    // nothing. (Only while the comment panel is open, which is why this looked like a
    // sidebar-width problem: with the panel closed this whole handler returns above.)
    if (event.target instanceof Element && event.target.closest(`[${MARK_LAYER_ATTR}], [${MARK_TOOLBAR_ATTR}]`)) return;
    const container = markContainerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) {
      // A plain click in the document (outside any mark — those returned above) dismisses
      // whatever the previous one opened.
      setSelectionPopover(undefined);
      setActiveMark(undefined);
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
    // The toolbar lives inside the (positioned) document element, so it scrolls along with the
    // text it points at instead of drifting off it.
    const origin = container.getBoundingClientRect();
    setSelectedMemoName(undefined);
    setSelectionPopover({
      top: rect.top - origin.top,
      left: rect.left - origin.left + rect.width / 2,
      anchor: buildSelectionAnchor(container, range),
    });
  };

  // Creates a bare mark — a comment with no written note, existing only to colour its text —
  // directly from the selection, the way the EPUB reader does. Adding a note to it later is a
  // plain comment edit; the anchor and styling ride along untouched.
  const createMark = useCallback(
    async (color: string, underline: boolean) => {
      if (!selectionPopover) return;
      const anchor = { ...selectionPopover.anchor, color, underline };
      setSelectionPopover(undefined);
      // The toolbar deliberately keeps the selection alive while it is open (its mouse-down is
      // prevented). Once the mark exists, that selection is done with — drop it, so the browser
      // doesn't keep painting it over the new mark and the next click starts from a clean slate.
      clearSelection();
      await memoServiceClient.createMemoComment({
        name: memo.name,
        comment: create(MemoSchema, { content: "", docAnchor: anchor }),
      });
      refetchComments();
    },
    [selectionPopover, memo.name, refetchComments],
  );

  // Fired from the toolbar's note button: open the comments panel and start composing, anchored
  // to the selection. The note also marks its text (as a default-coloured highlight), so writing
  // a comment about a passage and highlighting it are the same act rather than two separate ones.
  const composeFromSelection = () => {
    if (!selectionPopover) return;
    setOutlineCollapsed(true);
    setCommentsOpen(true);
    const anchor = selectionPopover.anchor;
    setComposeRequest({
      anchor: anchor.textExact ? { ...anchor, color: anchor.color || DEFAULT_MARK_COLOR } : anchor,
      nonce: Date.now(),
    });
    setSelectionPopover(undefined);
    clearSelection();
  };

  // Clicking a mark selects its comment (the mark brightens, the panel opens on it) and puts the
  // toolbar over it, so an existing mark can be recoloured or cleared in place — the same gesture
  // the EPUB reader uses. Without this a bare mark, which has no sidebar card of its own, would
  // have no way to be undone.
  const handleMarkClick = useCallback((memoName: string, point: { x: number; y: number }) => {
    setSelectionPopover(undefined);
    setSelectedMemoName(memoName);
    setActiveMark({ memoName, x: point.x, y: point.y });
    setOutlineCollapsed(true);
    setCommentsOpen(true);
  }, []);

  // Restyle an existing mark, keeping its anchor and any note it carries.
  const updateMarkStyle = useCallback(
    async (comment: Memo, color: string, underline: boolean) => {
      setActiveMark(undefined);
      if (!comment.docAnchor) return;
      // Re-picking what the mark already has changes nothing — don't spend a round trip on it.
      if ((comment.docAnchor.color ?? "") === color && (comment.docAnchor.underline ?? false) === underline) return;
      await memoServiceClient.updateMemo({
        memo: create(MemoSchema, { name: comment.name, docAnchor: { ...comment.docAnchor, color, underline } }),
        updateMask: create(FieldMaskSchema, { paths: ["doc_anchor"] }),
      });
      refetchComments();
    },
    [refetchComments],
  );

  // Clearing a mark that carries a note only drops its styling — the note is the valuable part
  // and stays, still anchored to its text. A bare mark *is* only its styling, so clearing it
  // removes the comment outright.
  const clearMark = useCallback(
    async (comment: Memo) => {
      setActiveMark(undefined);
      setSelectedMemoName(undefined);
      if (comment.content.trim()) await updateMarkStyle(comment, "", false);
      else {
        await memoServiceClient.deleteMemo({ name: comment.name });
        refetchComments();
      }
    },
    [updateMarkStyle, refetchComments],
  );

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
                <GalleryViewRenderer memo={memo} onOpenDoc={onOpenDocument} readonly={false} />
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
            // Positioned, so the mark overlay and the mark toolbar can be placed against the
            // rendered document and scroll with it.
            <div ref={markContainerRef} className="relative px-6 py-4">
              <MemoViewContext.Provider value={buildPreviewContext(memo)}>
                <MemoContent content={memo.content} memoName={memo.name} />
              </MemoViewContext.Provider>
              {remainingAttachments.length > 0 && (
                <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                  <AttachmentListView attachments={remainingAttachments} />
                </div>
              )}
              {supportsMarks && (
                <DocMarkLayer
                  containerRef={markContainerRef}
                  marks={marks}
                  contentKey={memo.content}
                  selectedMemoName={selectedMemoName}
                  // Marking is a comment-panel activity: with the panel collapsed the document is
                  // just a document, so marks are shown but inert — the same rule the selection
                  // toolbar follows. Open the panel first, then mark or restyle.
                  onMarkClick={commentsOpen ? handleMarkClick : undefined}
                  onUnresolved={setUnresolvedMarks}
                  onAnchors={setMarkAnchors}
                />
              )}
              {selectionPopover && commentsOpen && (
                <MarkToolbar
                  x={selectionPopover.left}
                  y={selectionPopover.top}
                  activeColorKey=""
                  activeUnderline={false}
                  onColor={(colorKey) => createMark(colorKey, false)}
                  onUnderline={() => createMark("", true)}
                  onNote={composeFromSelection}
                />
              )}
              {activeMarkComment && activeMark && (
                <MarkToolbar
                  // The live position wins over the clicked one; the latter only covers the frame
                  // before the first remeasure, and the case where the mark went unresolved.
                  x={markAnchors[activeMark.memoName]?.x ?? activeMark.x}
                  y={markAnchors[activeMark.memoName]?.y ?? activeMark.y}
                  activeColorKey={activeMarkComment.docAnchor?.color ?? ""}
                  activeUnderline={activeMarkComment.docAnchor?.underline ?? false}
                  // Picking a colour only ever applies it — clicking the current one again is a
                  // no-op, not a toggle-off. Removing a mark is the eraser button's job, and
                  // conflating the two makes re-picking the same colour feel like a misfire.
                  onColor={(colorKey) => updateMarkStyle(activeMarkComment, colorKey, activeMarkComment.docAnchor?.underline ?? false)}
                  onUnderline={() =>
                    updateMarkStyle(
                      activeMarkComment,
                      activeMarkComment.docAnchor?.color ?? "",
                      !(activeMarkComment.docAnchor?.underline ?? false),
                    )
                  }
                  onNote={() => {
                    setActiveMark(undefined);
                    setEditingMarkComment(activeMarkComment);
                  }}
                  onClear={() => clearMark(activeMarkComment)}
                />
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
              comments={notedComments}
              onClose={() => setCommentsOpen(false)}
              onChanged={refetchComments}
              getAnchor={() => nearestHeadingAnchor(previewRef.current)}
              onJump={(anchor) => scrollToAnchor(previewRef.current, markContainerRef.current, anchor)}
              composeRequest={composeRequest}
              selectedMemoName={selectedMemoName}
              onSelect={setSelectedMemoName}
              unresolvedMarks={unresolvedMarks}
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
                comments={notedComments}
                onChanged={refetchComments}
                getAnchor={() => nearestHeadingAnchor(previewRef.current)}
                onJump={(anchor) => {
                  setCommentsOpen(false);
                  scrollToAnchor(previewRef.current, markContainerRef.current, anchor);
                }}
                composeRequest={composeRequest}
                selectedMemoName={selectedMemoName}
                onSelect={setSelectedMemoName}
                unresolvedMarks={unresolvedMarks}
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

      {/* Writing a note onto an existing bare mark. It's a plain comment edit — the mark keeps
          its anchor and colour, and simply starts appearing in the sidebar once it has text. */}
      {editingMarkComment && (
        <Dialog open onOpenChange={(open) => !open && setEditingMarkComment(undefined)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("epub.add-annotation")}</DialogTitle>
            </DialogHeader>
            {editingMarkComment.docAnchor?.textExact && (
              <div className="mb-1 max-h-24 overflow-y-auto rounded-md bg-accent/40 px-2 py-1.5 text-xs text-muted-foreground">
                {editingMarkComment.docAnchor.textExact}
              </div>
            )}
            <MemoEditor
              autoFocus
              memo={editingMarkComment}
              parentMemoName={memo.name}
              toolbarVariant="comment"
              onConfirm={() => {
                setEditingMarkComment(undefined);
                refetchComments();
              }}
              onCancel={() => setEditingMarkComment(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DocumentView;
