import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ExpandIcon,
  HistoryIcon,
  LinkIcon,
  MessageCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PaperclipIcon,
  PencilIcon,
  SaveIcon,
  Settings2Icon,
  TrashIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { DocCommentSidebar } from "@/components/DocComments/DocCommentSidebar";
import { type DocMark, DocMarkLayer } from "@/components/DocComments/DocMarkLayer";
import { anchorTextQuote, buildSelectionAnchor, scrollToAnchor } from "@/components/DocComments/docAnchor";
import { MARK_LAYER_ATTR } from "@/components/DocComments/textAnchor";
import { useAnchorHealth } from "@/components/DocComments/useAnchorHealth";
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
  DropdownMenuCheckboxItem,
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
import useMediaQuery from "@/hooks/useMediaQuery";
import { useCreateMemoHistory, useMemoHistories, useRestoreMemoHistory } from "@/hooks/useMemoHistoryQueries";
import { useInfiniteMemoComments, useUpdateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import {
  type DocAnchor,
  DocConfigSchema,
  type Memo,
  Memo_DocType,
  type MemoHistory,
  MemoSchema,
} from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl, partitionInlinedAttachments } from "@/utils/attachment";
import { type ResolvedDocConfig, resolveMemoDocConfig } from "@/utils/docConfig";
import { type MemoProperty, setFrontmatterProperty } from "@/utils/frontmatter";
import { useTranslate } from "@/utils/i18n";
import { DEFAULT_MARK_COLOR } from "@/utils/markColors";
import { attachmentUIDsOf, hashMemoState } from "@/utils/memoState";
import { useReadingDensity } from "@/utils/readingDensity";
import { getDocScrollPosition, restoreScrollTopWhenReady, saveDocScrollPosition } from "@/utils/scrollPositionCache";
import DocumentOutline, { ATTACHMENTS_ANCHOR_ID } from "./DocumentOutline";

interface Props {
  memo: Memo;
  onSaved: () => void;
  onRenamed: (title: string) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onSaveHtml: (content: string) => void;
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
  onAddAttachments,
  onRemoveAttachment,
  onOpenDocument,
}: Props) => {
  const t = useTranslate();
  const isDesktop = useMediaQuery("lg");
  const isHtml = memo.docType === Memo_DocType.HTML;
  const isPdf = memo.docType === Memo_DocType.PDF;
  const isView = memo.docType === Memo_DocType.VIEW;
  const pdfAttachment = isPdf ? memo.attachments.find((a) => a.type === "application/pdf") : undefined;
  const remainingAttachments = partitionInlinedAttachments(memo.attachments, memo.content).rest;
  // Comments are available for markdown/view docs (PDF has its own annotation sidebar; HTML is skipped).
  const supportsComments = !isPdf && !isHtml;
  // Text marks (highlight / underline) follow prose. VIEW docs qualify through their markdown
  // blocks; the card walls they also render are live query results, and the renderer keeps those
  // out of anchoring so a mark can never latch onto a card that a later query drops.
  const supportsMarks = supportsComments;
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
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () =>
      !resolveMemoDocConfig(memo).displayOutline || (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches),
  );
  const [htmlDraft, setHtmlDraft] = useState(memo.content);
  const [titleDraft, setTitleDraft] = useState(memo.title);
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
  // Which comments can still find what they were written about. Orphans are the ones the
  // document has edited out from under them.
  const anchorHealth = useAnchorHealth(docComments, unresolvedMarks, markContainerRef, memo.content);
  // What the panel lists: everything with a note, plus anything that has come adrift — including
  // a note-less mark, which is invisible in the document once its text is gone and would
  // otherwise be impossible to re-anchor or delete.
  const listedComments = useMemo(
    () => docComments.filter((c) => c.content.trim() || anchorHealth.get(c.name) === "orphan"),
    [docComments, anchorHealth],
  );
  // The comment being re-anchored: while this is set, selecting text in the document offers
  // "anchor it here" instead of the usual new-mark toolbar.
  const [relinkTarget, setRelinkTarget] = useState<Memo>();

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
    // A document configured with the outline off opens collapsed; otherwise fall back to the
    // viewport check. Only the *default* — the toolbar toggle still wins for this session.
    setOutlineCollapsed(
      !resolveMemoDocConfig(memo).displayOutline || (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches),
    );
  }, [memo.name]);

  // Narrowing to a phone-sized viewport (opening on a phone, or rotating a tablet to portrait)
  // must not leave the outline docked/opened over the document — it only ever opens by an
  // explicit tap there. Widening never re-opens it; that stays the user's choice.
  useEffect(() => {
    if (!isDesktop) setOutlineCollapsed(true);
  }, [isDesktop]);

  const isArchived = memo.state === State.ARCHIVED;

  // How this document is framed (width, outline, folder tree, properties panel). Stored on the
  // memo; frontmatter has no say in it — properties are for what the document says, never for
  // how it looks. Reading density is deliberately absent too: that's a reader preference, kept
  // per-device in localStorage.
  const docConfig = useMemo(() => resolveMemoDocConfig(memo), [memo.docConfig]);
  const { density } = useReadingDensity();
  const { mutateAsync: updateMemoAsync } = useUpdateMemo();

  // Flipping a switch writes the payload only: no content revision, no `updatedTs` bump, no
  // memogit diff, no re-embedding.
  const updateDocConfig = useCallback(
    async (patch: Partial<ResolvedDocConfig>) => {
      try {
        await updateMemoAsync({
          update: { name: memo.name, docConfig: create(DocConfigSchema, { ...docConfig, ...patch }) },
          updateMask: ["doc_config"],
        });
      } catch {
        toast.error(t("message.update-failed"));
      }
    },
    [docConfig, memo.name, updateMemoAsync, t],
  );

  // Editing a header property from the preview: only the one frontmatter line changes, and the
  // document is saved through the same path the raw editor uses. Offered for markdown and VIEW
  // documents (the two doc types that carry frontmatter), and never on an archived one.
  const handlePropertyChange = useCallback(
    (key: string, value: MemoProperty["value"]) => {
      onSaveHtml(setFrontmatterProperty(memo.content, key, value));
    },
    [memo.content, onSaveHtml],
  );
  const propertyChangeHandler = !isHtml && !isPdf && !isArchived && mode === "preview" ? handlePropertyChange : undefined;

  const handleOpenReader = () => {
    window.open(`/${memo.name}/reader`, "_blank", "noopener");
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
    // Selecting to mark/comment is only offered while the comment panel is open — or while a
    // comment is waiting to be re-anchored, which on a phone deliberately closes the panel first.
    if (!supportsMarks || mode !== "preview" || (!commentsOpen && !relinkTarget)) return;
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

  // Start re-anchoring an orphaned comment. The document has to be readable and selectable for
  // this, so leave edit mode, drop anything else that owns the selection, and — on a phone, where
  // the panel is a sheet covering the document — get the panel out of the way.
  const startRelink = useCallback(
    (comment: Memo) => {
      setRelinkTarget(comment);
      setMode("preview");
      setSelectionPopover(undefined);
      setActiveMark(undefined);
      setSelectedMemoName(undefined);
      setOutlineCollapsed(true);
      if (!isDesktop) setCommentsOpen(false);
    },
    [isDesktop],
  );

  const cancelRelink = useCallback(() => {
    setRelinkTarget(undefined);
    setSelectionPopover(undefined);
    clearSelection();
  }, []);

  useEffect(() => {
    if (!relinkTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRelink();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [relinkTarget, cancelRelink]);

  // Point the comment at the freshly selected text. Only the anchor changes — the note, and the
  // mark's own styling, ride along — so re-anchoring is a repair, not a rewrite. A comment that
  // had no mark of its own (a legacy heading-anchored one) becomes a normal highlight, since
  // from here on a comment's anchor *is* its mark.
  const confirmRelink = useCallback(async () => {
    if (!relinkTarget || !selectionPopover?.anchor.textExact) return;
    const previous = relinkTarget.docAnchor;
    const style = previous?.textExact
      ? { color: previous.color ?? "", underline: previous.underline ?? false }
      : { color: DEFAULT_MARK_COLOR, underline: false };
    const anchor = { ...selectionPopover.anchor, ...style };
    setRelinkTarget(undefined);
    setSelectionPopover(undefined);
    clearSelection();
    await memoServiceClient.updateMemo({
      memo: create(MemoSchema, { name: relinkTarget.name, docAnchor: anchor }),
      updateMask: create(FieldMaskSchema, { paths: ["doc_anchor"] }),
    });
    setCommentsOpen(true);
    setSelectedMemoName(relinkTarget.name);
    refetchComments();
  }, [relinkTarget, selectionPopover, refetchComments]);

  // Deleting an orphan is the other way out of the panel's orphan pile, for a comment that is
  // simply no longer worth re-anchoring.
  const deleteComment = useCallback(
    async (comment: Memo) => {
      if (!window.confirm(t("memo.delete-confirm"))) return;
      if (relinkTarget?.name === comment.name) cancelRelink();
      await memoServiceClient.deleteMemo({ name: comment.name });
      refetchComments();
    },
    [t, relinkTarget, cancelRelink, refetchComments],
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

  // The in-text marking apparatus: the overlay plus the two floating toolbars (one for a fresh
  // selection, one for an existing mark). Rendered as the last child of whichever positioned
  // element wraps the rendered document — a markdown document, or a VIEW document's blocks.
  const markOverlay = supportsMarks && mode === "preview" && (
    <>
      <DocMarkLayer
        containerRef={markContainerRef}
        marks={marks}
        contentKey={memo.content}
        selectedMemoName={selectedMemoName}
        // Marking is a comment-panel activity: with the panel collapsed the document is just a
        // document, so marks are shown but inert — the same rule the selection toolbar follows.
        // Open the panel first, then mark or restyle.
        onMarkClick={commentsOpen && !relinkTarget ? handleMarkClick : undefined}
        onUnresolved={setUnresolvedMarks}
        onAnchors={setMarkAnchors}
      />
      {/* While re-anchoring, a selection means "put it here" — the mark toolbar would offer to
          create a second, unrelated mark instead. It carries the toolbar's own attribute so the
          document's mouse-up handler doesn't dismiss it before the click lands. */}
      {selectionPopover && relinkTarget && selectionPopover.anchor.textExact && (
        <div
          {...{ [MARK_TOOLBAR_ATTR]: "" }}
          className={cn(
            "absolute z-20 -translate-x-1/2 rounded-lg border border-border bg-popover p-1 shadow-md",
            selectionPopover.top >= 44 && "-translate-y-full",
          )}
          style={{ left: selectionPopover.left, top: selectionPopover.top >= 44 ? selectionPopover.top - 6 : selectionPopover.top + 26 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Button size="sm" className="h-7 text-xs" onClick={confirmRelink}>
            <LinkIcon className="mr-1 h-3.5 w-3.5" />
            {t("mark.relink-here")}
          </Button>
        </div>
      )}
      {selectionPopover && commentsOpen && !relinkTarget && (
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
      {activeMarkComment && activeMark && !relinkTarget && (
        <MarkToolbar
          // The live position wins over the clicked one; the latter only covers the frame before
          // the first remeasure, and the case where the mark went unresolved.
          x={markAnchors[activeMark.memoName]?.x ?? activeMark.x}
          y={markAnchors[activeMark.memoName]?.y ?? activeMark.y}
          activeColorKey={activeMarkComment.docAnchor?.color ?? ""}
          activeUnderline={activeMarkComment.docAnchor?.underline ?? false}
          // Picking a colour only ever applies it — clicking the current one again is a no-op,
          // not a toggle-off. Removing a mark is the eraser button's job, and conflating the two
          // makes re-picking the same colour feel like a misfire.
          onColor={(colorKey) => updateMarkStyle(activeMarkComment, colorKey, activeMarkComment.docAnchor?.underline ?? false)}
          onUnderline={() =>
            updateMarkStyle(activeMarkComment, activeMarkComment.docAnchor?.color ?? "", !(activeMarkComment.docAnchor?.underline ?? false))
          }
          onNote={() => {
            setActiveMark(undefined);
            setEditingMarkComment(activeMarkComment);
          }}
          onClear={() => clearMark(activeMarkComment)}
        />
      )}
    </>
  );

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
              {/* This document's own framing. Reading density is NOT here: it's a per-reader
                  preference and lives in the appearance settings, applied to every document. */}
              {!isPdf && !isHtml && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Settings2Icon className="w-4 h-4 mr-2" />
                    {t("notebook.document-settings")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuCheckboxItem
                      checked={docConfig.fullWidth}
                      onCheckedChange={(checked) => updateDocConfig({ fullWidth: checked })}
                    >
                      {t("notebook.full-width")}
                    </DropdownMenuCheckboxItem>
                    {!isView && (
                      <DropdownMenuCheckboxItem
                        checked={docConfig.displayOutline}
                        onCheckedChange={(checked) => {
                          updateDocConfig({ displayOutline: checked });
                          // The stored value is only a default for the *next* open, so apply it
                          // now too — otherwise the switch appears to do nothing.
                          setOutlineCollapsed(!checked || !isDesktop);
                          if (checked) setCommentsOpen(false);
                        }}
                      >
                        {t("notebook.show-outline")}
                      </DropdownMenuCheckboxItem>
                    )}
                    <DropdownMenuCheckboxItem
                      checked={docConfig.displayFilter}
                      onCheckedChange={(checked) => updateDocConfig({ displayFilter: checked })}
                    >
                      {t("notebook.show-document-tree")}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={docConfig.showProperties}
                      onCheckedChange={(checked) => updateDocConfig({ showProperties: checked })}
                    >
                      {t("notebook.show-properties")}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
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

      <CreateVersionDialog open={createVersionDialogOpen} onOpenChange={setCreateVersionDialogOpen} onConfirm={handleCreateVersion} />

      {relinkTarget && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border bg-primary/10 px-4 py-1.5 text-xs">
          <span className="min-w-0 truncate text-foreground">
            {t("mark.relink-hint")}
            {relinkTarget.docAnchor?.textExact && (
              <span className="ml-1.5 text-muted-foreground line-through">{relinkTarget.docAnchor.textExact}</span>
            )}
          </span>
          <Button variant="ghost" size="sm" className="h-6 shrink-0 text-xs" onClick={cancelRelink}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

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
              // Positioned for the mark overlay, exactly like the markdown preview. A VIEW doc's
              // markdown blocks are ordinary prose and get the same marking; its card walls are
              // live query results and are excluded from anchoring by the renderer.
              <div ref={markContainerRef} className={cn("relative px-6 py-4", !docConfig.fullWidth && "mx-auto w-full max-w-3xl")}>
                {/* Only the memo name crosses over: the gallery's second argument is the matched
                    document, while callers of onOpenDocument take an anchor href there — passing
                    the callback straight through made every card click throw. */}
                <GalleryViewRenderer
                  memo={memo}
                  onOpenDoc={(memoName) => onOpenDocument?.(memoName)}
                  onPropertyChange={propertyChangeHandler}
                  showProperties={docConfig.showProperties}
                  readonly={false}
                />
                {remainingAttachments.length > 0 && (
                  <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                    <AttachmentListView attachments={remainingAttachments} />
                  </div>
                )}
                {markOverlay}
              </div>
            ) : (
              <div className="h-full">
                <GalleryViewForm
                  key={memo.name}
                  content={memo.content}
                  workspace={memo.workspace}
                  memoName={memo.name}
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
            // Narrowing is a per-document choice, applied to the reading view only: the raw
            // editor is a different job and keeps the whole pane.
            <div ref={markContainerRef} className={cn("relative px-6 py-4", !docConfig.fullWidth && "mx-auto w-full max-w-3xl")}>
              <MemoViewContext.Provider value={buildPreviewContext(memo)}>
                <MemoContent
                  content={memo.content}
                  memoName={memo.name}
                  density={density}
                  showProperties={docConfig.showProperties}
                  onPropertyChange={propertyChangeHandler}
                />
              </MemoViewContext.Provider>
              {remainingAttachments.length > 0 && (
                <div id={ATTACHMENTS_ANCHOR_ID} className="mt-6 border-t border-border pt-4">
                  <AttachmentListView attachments={remainingAttachments} />
                </div>
              )}
              {markOverlay}
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
              comments={listedComments}
              onClose={() => setCommentsOpen(false)}
              onChanged={refetchComments}
              onJump={(anchor) => scrollToAnchor(previewRef.current, markContainerRef.current, anchor)}
              composeRequest={composeRequest}
              selectedMemoName={selectedMemoName}
              onSelect={setSelectedMemoName}
              anchorHealth={anchorHealth}
              onRelink={startRelink}
              onDelete={deleteComment}
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
                comments={listedComments}
                onChanged={refetchComments}
                onJump={(anchor) => {
                  setCommentsOpen(false);
                  scrollToAnchor(previewRef.current, markContainerRef.current, anchor);
                }}
                composeRequest={composeRequest}
                selectedMemoName={selectedMemoName}
                onSelect={setSelectedMemoName}
                anchorHealth={anchorHealth}
                onRelink={startRelink}
                onDelete={deleteComment}
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
