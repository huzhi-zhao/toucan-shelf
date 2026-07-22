import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MemoEditor from "@/components/MemoEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { memoServiceClient } from "@/connect";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { EpubAnnotationSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { EpubAnnotationSidebar } from "./EpubAnnotationSidebar";
import { EpubMarkToolbar } from "./EpubMarkToolbar";
import { EpubToolbar } from "./EpubToolbar";
import { DEFAULT_MARK_COLOR, getMarkColor } from "./epubMarks";
import { type EpubSettings, getBackgroundPreset, loadEpubSettings, saveEpubSettings } from "./epubSettings";
import { useEpubAnnotations } from "./useEpubAnnotations";
import { useEpubBook } from "./useEpubBook";
import { MAX_FONT_SCALE, MIN_FONT_SCALE, useEpubRendition } from "./useEpubRendition";

interface Props {
  url: string;
  /** DOM node (typically a slot in a parent title bar) the toolbar is portaled into. */
  toolbarSlot: HTMLElement;
  className?: string;
  /** The memo this EPUB is attached to. Annotation comments are anchored to it. Omit to disable annotations. */
  parentMemoName?: string;
  /** The attachment's resource name (attachments/{uid}), used to anchor annotations to this file. */
  attachmentName?: string;
  /** CFI to open on (e.g. restored from a scroll-position cache). Only applied on mount/url change. */
  initialCfi?: string;
  /** Fired whenever the reading location changes, with the current CFI. */
  onLocationChange?: (cfi: string) => void;
}

// Renders an EPUB with a toolbar (portaled into a caller-provided slot, e.g. a document
// title bar) and the book area inline — mirroring PdfDocumentView so the two document
// readers plug into the same surfaces (AttachmentPreview, Notebook DocumentView).
export const EpubDocumentView = ({ url, toolbarSlot, className, parentMemoName, attachmentName, initialCfi, onLocationChange }: Props) => {
  const t = useTranslate();
  const isDesktop = useMediaQuery("lg");
  const { bookRef, toc, loading, error } = useEpubBook(url);
  const [settings, setSettings] = useState<EpubSettings>(loadEpubSettings);
  const updateSettings = useCallback((patch: Partial<EpubSettings>) => {
    setSettings((prev) => {
      const nextSettings = { ...prev, ...patch };
      saveEpubSettings(nextSettings);
      return nextSettings;
    });
  }, []);

  const canAnnotate = !!parentMemoName && !!attachmentName;
  const [annotateMode, setAnnotateMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedMemoName, setSelectedMemoName] = useState<string>();
  // The floating mark toolbar appears in two situations, both rendering EpubMarkToolbar:
  // after finishing a text selection (create a new mark) and after clicking an existing mark
  // (restyle it or add a note). Only one is ever set at a time.
  const [pendingSelection, setPendingSelection] = useState<{ cfiRange: string; text: string; x: number; y: number }>();
  const [activeMark, setActiveMark] = useState<{ memo: Memo; x: number; y: number }>();
  const [pendingAnnotation, setPendingAnnotation] = useState<{ cfiRange: string; text: string }>();
  // Adding/editing the note on an existing mark opens the editor for its memo.
  const [editingMemo, setEditingMemo] = useState<Memo>();
  const { all: annotations, refetch } = useEpubAnnotations(parentMemoName, attachmentName);

  const closeToolbars = useCallback(() => {
    setPendingSelection(undefined);
    setActiveMark(undefined);
  }, []);

  // Every annotation renders as an in-text mark; only ones with a written note show in the
  // sidebar list (bare marks stay visible in the book but don't clutter the note list).
  const highlights = useMemo(
    () =>
      annotations.map((a) => ({
        cfiRange: a.cfiRange,
        memoName: a.memo.name,
        // An empty color key means "no background fill" (e.g. an underline-only mark); the
        // background and the underline are independent and can be applied together.
        bgColor: a.color ? getMarkColor(a.color).color : undefined,
        underline: a.underline,
      })),
    [annotations],
  );
  const notedAnnotations = useMemo(() => annotations.filter((a) => a.hasNote), [annotations]);

  const handleSelected = useCallback(
    (cfiRange: string, text: string, anchor: { x: number; y: number }) => {
      if (!canAnnotate || !text) return;
      setActiveMark(undefined);
      setPendingSelection({ cfiRange, text, x: anchor.x, y: anchor.y });
    },
    [canAnnotate],
  );

  // Create a bare mark (highlight/underline with no note) directly, without opening the editor.
  const createMark = useCallback(
    async (color: string, underline: boolean) => {
      if (!parentMemoName || !attachmentName || !pendingSelection) return;
      const { cfiRange, text } = pendingSelection;
      setPendingSelection(undefined);
      await memoServiceClient.createMemoComment({
        name: parentMemoName,
        comment: create(MemoSchema, {
          content: "",
          epubAnnotation: create(EpubAnnotationSchema, { attachmentName, cfiRange, textSnippet: text, color, underline }),
        }),
      });
      refetch();
    },
    [parentMemoName, attachmentName, pendingSelection, refetch],
  );

  // Restyle an existing mark's color / underline, keeping its anchor (CFI + snippet) and note.
  const updateMarkStyle = useCallback(
    async (memo: Memo, color: string, underline: boolean) => {
      setActiveMark(undefined);
      const prev = memo.epubAnnotation;
      if (!prev) return;
      await memoServiceClient.updateMemo({
        memo: create(MemoSchema, {
          name: memo.name,
          epubAnnotation: create(EpubAnnotationSchema, {
            attachmentName: prev.attachmentName,
            cfiRange: prev.cfiRange,
            textSnippet: prev.textSnippet,
            color,
            underline,
          }),
        }),
        updateMask: create(FieldMaskSchema, { paths: ["epub_annotation"] }),
      });
      refetch();
    },
    [refetch],
  );

  // Clear a mark's styling. A bare mark (no note) is deleted outright; a mark that carries a
  // note is kept — the note must survive — and just reset to the default background color so
  // it stays visible and locatable in the book.
  const clearMark = useCallback(
    async (memo: Memo) => {
      setActiveMark(undefined);
      if (memo.content.trim().length > 0) {
        await updateMarkStyle(memo, DEFAULT_MARK_COLOR, false);
        return;
      }
      await memoServiceClient.deleteMemo({ name: memo.name });
      refetch();
    },
    [updateMarkStyle, refetch],
  );

  const rendition = useEpubRendition({
    bookRef,
    ready: !loading && !error,
    flow: settings.flow,
    settings,
    initialCfi,
    onLocationChange,
    highlights: canAnnotate ? highlights : undefined,
    annotateMode: canAnnotate && annotateMode,
    onSelected: handleSelected,
    onSelectionCleared: closeToolbars,
    onHighlightClick: (memoName, anchor) => {
      // Clicking a mark surfaces the same toolbar as a fresh selection, so the reader can
      // recolor it, switch it to an underline, or add/edit its note.
      const entry = annotations.find((a) => a.memo.name === memoName);
      if (!entry) return;
      setPendingSelection(undefined);
      setActiveMark({ memo: entry.memo, x: anchor.x, y: anchor.y });
    },
  });
  const { containerRef, next, prev, goToCfi, clearSelection } = rendition;
  const nextRef = useRef(next);
  const prevRef = useRef(prev);
  nextRef.current = next;
  prevRef.current = prev;

  // Left/right arrows flip pages, matching e-reader convention. Scoped to keydown on the
  // window but ignored while typing in an input so it doesn't hijack form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === "ArrowRight") nextRef.current();
      else if (e.key === "ArrowLeft") prevRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Jump to a comment's highlight, and (on mobile) close the sheet so the jump is visible.
  const handleSidebarSelect = (memoName: string, cfiRange: string) => {
    setSelectedMemoName(memoName);
    if (!isDesktop) setSidebarOpen(false);
    goToCfi(cfiRange);
  };

  // Gutter background for fixed-color presets; "theme" (bg === null) leaves the app
  // background showing through.
  const containerBg = getBackgroundPreset(settings.background).bg;

  if (error) {
    return <div className={cn("w-full p-6 text-center text-sm text-destructive", className)}>{t("epub.load-failed")}</div>;
  }

  const sidebar = (forDesktop: boolean) => (
    <EpubAnnotationSidebar
      className={forDesktop ? undefined : "w-full max-w-full border-l-0 border-t-0"}
      annotations={notedAnnotations}
      selectedMemoName={selectedMemoName}
      onClose={forDesktop ? () => setSidebarOpen(false) : undefined}
      onEdited={refetch}
      onSelect={handleSidebarSelect}
    />
  );

  return (
    <>
      {createPortal(
        <EpubToolbar
          toc={toc}
          flow={settings.flow}
          loading={loading || rendition.displaying}
          fontScale={rendition.fontScale}
          canDecreaseFont={rendition.fontScale > MIN_FONT_SCALE}
          canIncreaseFont={rendition.fontScale < MAX_FONT_SCALE}
          settings={settings}
          onSettingsChange={updateSettings}
          annotateMode={canAnnotate ? annotateMode : undefined}
          onToggleAnnotateMode={canAnnotate ? () => setAnnotateMode((v) => !v) : undefined}
          sidebarOpen={canAnnotate ? sidebarOpen : undefined}
          onToggleSidebar={canAnnotate ? () => setSidebarOpen((v) => !v) : undefined}
          onPrev={prev}
          onNext={next}
          onToggleFlow={() => updateSettings({ flow: settings.flow === "paginated" ? "scrolled-doc" : "paginated" })}
          onDecreaseFont={rendition.decreaseFont}
          onIncreaseFont={rendition.increaseFont}
          onNavigate={rendition.goToHref}
        />,
        toolbarSlot,
      )}
      <div className="w-full flex items-start">
        {/* The chosen background also tints the page gutters/margins around the book iframe,
            so the reading surface reads as one color rather than paper-on-app-background. */}
        <div className={cn("relative min-w-0 flex-1", className)} style={containerBg ? { background: containerBg } : undefined}>
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">{t("epub.loading")}</div>
          )}
          {/* epub.js needs a fixed-height box to lay out paginated columns into. */}
          <div ref={containerRef} className="h-[calc(100vh-6rem)] w-full" />
          {pendingSelection && (
            <EpubMarkToolbar
              x={pendingSelection.x}
              y={pendingSelection.y}
              // A fresh selection has no style yet; the first pick creates a background-only
              // or underline-only mark. Stacking the two is done by clicking the mark again.
              activeColorKey=""
              activeUnderline={false}
              onColor={(colorKey) => {
                createMark(colorKey, false);
                clearSelection();
              }}
              onUnderline={() => {
                createMark("", true);
                clearSelection();
              }}
              onNote={() => {
                setPendingAnnotation({ cfiRange: pendingSelection.cfiRange, text: pendingSelection.text });
                setPendingSelection(undefined);
                clearSelection();
              }}
            />
          )}
          {activeMark && (
            <EpubMarkToolbar
              x={activeMark.x}
              y={activeMark.y}
              activeColorKey={activeMark.memo.epubAnnotation?.color ?? ""}
              activeUnderline={activeMark.memo.epubAnnotation?.underline ?? false}
              // Background and underline toggle independently, so each handler keeps the other's
              // current state — letting a mark carry both at once. Re-picking the active color
              // clears the background.
              onColor={(colorKey) => {
                const ann = activeMark.memo.epubAnnotation;
                const nextColor = ann?.color === colorKey ? "" : colorKey;
                updateMarkStyle(activeMark.memo, nextColor, ann?.underline ?? false);
              }}
              onUnderline={() => {
                const ann = activeMark.memo.epubAnnotation;
                updateMarkStyle(activeMark.memo, ann?.color ?? "", !(ann?.underline ?? false));
              }}
              onNote={() => {
                setEditingMemo(activeMark.memo);
                setActiveMark(undefined);
              }}
              onClear={() => clearMark(activeMark.memo)}
            />
          )}
        </div>
        {canAnnotate && sidebarOpen && isDesktop && (
          <div className="relative sticky top-0 h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] w-[30%] min-w-[240px] shrink-0">
            {sidebar(true)}
          </div>
        )}
      </div>
      {canAnnotate && sidebarOpen && !isDesktop && (
        <Sheet open onOpenChange={(open) => !open && setSidebarOpen(false)}>
          <SheetContent side="right" className="w-[85%] max-w-full overflow-y-auto px-2 py-3 bg-background">
            <SheetHeader>
              <SheetTitle>{t("epub.annotations")}</SheetTitle>
            </SheetHeader>
            {sidebar(false)}
          </SheetContent>
        </Sheet>
      )}
      {pendingAnnotation && parentMemoName && attachmentName && (
        <Dialog open onOpenChange={(open) => !open && setPendingAnnotation(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("epub.add-annotation")}</DialogTitle>
            </DialogHeader>
            <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground line-clamp-4">
              {pendingAnnotation.text}
            </blockquote>
            <MemoEditor
              autoFocus
              parentMemoName={parentMemoName}
              epubAnnotation={create(EpubAnnotationSchema, {
                attachmentName,
                cfiRange: pendingAnnotation.cfiRange,
                textSnippet: pendingAnnotation.text,
                color: DEFAULT_MARK_COLOR,
                underline: false,
              })}
              onConfirm={(memoName) => {
                setPendingAnnotation(undefined);
                setSelectedMemoName(memoName);
                setSidebarOpen(true);
                refetch();
              }}
              onCancel={() => setPendingAnnotation(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
      {editingMemo && (
        // Adding a note to a previously-created bare mark: edit the mark's memo in place, which
        // keeps its existing epubAnnotation (color/CFI) and just fills in the content.
        <Dialog open onOpenChange={(open) => !open && setEditingMemo(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("epub.add-annotation")}</DialogTitle>
            </DialogHeader>
            {editingMemo.epubAnnotation?.textSnippet && (
              <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground line-clamp-4">
                {editingMemo.epubAnnotation.textSnippet}
              </blockquote>
            )}
            <MemoEditor
              autoFocus
              memo={editingMemo}
              parentMemoName={editingMemo.parent || undefined}
              onConfirm={(memoName) => {
                setEditingMemo(undefined);
                setSelectedMemoName(memoName);
                setSidebarOpen(true);
                refetch();
              }}
              onCancel={() => setEditingMemo(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
