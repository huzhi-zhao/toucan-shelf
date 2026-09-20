import type { DocAnchor, EpubAnnotation, Location, Memo, PdfAnnotation, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import type { AudioRecorderStatus } from "../hooks/useAudioRecorder";

export interface MemoEditorProps {
  className?: string;
  cacheKey?: string;
  placeholder?: string;
  /** Existing memo to edit. When provided, the editor initializes from it without fetching. */
  memo?: Memo;
  parentMemoName?: string;
  /** Anchors the created comment to a location within a PDF attachment (create mode only). */
  pdfAnnotation?: PdfAnnotation;
  /** Anchors the created comment to a text range within an EPUB attachment (create mode only). */
  epubAnnotation?: EpubAnnotation;
  /** Anchors the created comment to a heading within a document memo (create mode only). */
  docAnchor?: DocAnchor;
  autoFocus?: boolean;
  /**
   * Default `createTime` for a *new* memo (create mode only). When set, the
   * editor seeds both `createTime` and `updateTime` to this value and renders
   * the timestamp popover so the user can adjust before saving. Tracked live:
   * if the prop changes after mount, the editor's timestamps re-sync. Ignored
   * in edit mode (when `memo` is set).
   */
  defaultCreateTime?: Date;
  onConfirm?: (memoName: string) => void;
  onCancel?: () => void;
  /** Grow the editor to fill its container's height instead of capping at the normal-mode max-height (e.g. a full-page editor like the Notebook document view). */
  expand?: boolean;
  /** Fired with the current markdown on every content change (e.g. to keep an outline sidebar live while editing). */
  onContentChange?: (content: string) => void;
  /**
   * Which bottom toolbar to render. `"comment"` swaps in the narrow variant used by
   * the comment sidebars (icon-only visibility, small Save/Cancel).
   */
  toolbarVariant?: "default" | "comment";
  /**
   * Size the editor to the space left below it in the viewport, instead of the
   * fixed cap a normal-mode editor gets (`max-height: 50vh`).
   *
   * For a surface where the editor IS the page's work area but the page has no
   * definite height to inherit — the memo detail page, which scrolls in the
   * document like every other page. `expand` cannot serve there: it sizes by
   * `height: 100%`, which needs a definite-height ancestor, and it also carries
   * the full-page editor's other choices (no card frame, sticky action bar,
   * periodic auto-save). This one changes height and nothing else.
   */
  fillViewport?: boolean;
  /**
   * Show the References block (this document's sub-documents, plus the controls
   * that create them). Opt-in rather than inferred: it is a Notebook-document
   * affordance, and the same editor also composes comments, where a sub-document
   * makes no sense. Ignored until the document exists — a sub-document needs a
   * parent to hang off.
   */
  showReferences?: boolean;
}

export interface EditorContentProps {
  placeholder?: string;
  expand?: boolean;
  /** See MemoEditorProps.fillViewport: the editor fills its host instead of capping. */
  fill?: boolean;
}

export interface EditorToolbarProps {
  onSave: () => void;
  onCancel?: () => void;
  memoName?: string;
  onAudioRecorderClick: () => void;
  /** Whether the formatting toolbar is shown in normal mode (persisted preference). */
  isFormattingToolbarVisible: boolean;
  onToggleFormattingToolbar: () => void;
  /** Insert an example frontmatter/properties block at the top of the document. */
  onInsertProperties: () => void;
  /** Tighter vertical spacing for the sticky bottom bar in expand mode. */
  compact?: boolean;
  /**
   * Opt-in periodic auto-save. The checkbox is rendered only when
   * `onToggleAutoSave` is provided (full-page editing of an existing document).
   */
  isAutoSaveEnabled?: boolean;
  onToggleAutoSave?: (enabled: boolean) => void;
}

export interface EditorMetadataProps {
  memoName?: string;
  /** See MemoEditorProps.showReferences. */
  showReferences?: boolean;
}

export interface AudioRecorderPanelProps {
  audioRecorder: { status: AudioRecorderStatus; elapsedSeconds: number };
  /** Active mic stream while recording; used for live waveform visualization. */
  mediaStream: MediaStream | null;
  onStop: () => void;
  onCancel: () => void;
  onTranscribe?: () => void;
  canTranscribe?: boolean;
  isTranscribing?: boolean;
}

export interface FocusModeOverlayProps {
  isActive: boolean;
  onToggle: () => void;
}

export interface FocusModeExitButtonProps {
  isActive: boolean;
  onToggle: () => void;
  title: string;
}

export interface InsertMenuProps {
  isUploading?: boolean;
  location?: Location;
  onLocationChange: (location?: Location) => void;
  onToggleFocusMode?: () => void;
  memoName?: string;
  onAudioRecorderClick?: () => void;
  /** Persisted toggle for the normal-mode formatting toolbar. */
  isFormattingToolbarVisible?: boolean;
  onToggleFormattingToolbar?: () => void;
  /** Insert an example frontmatter/properties block at the top of the document. */
  onInsertProperties?: () => void;
}

export interface VisibilitySelectorProps {
  value: Visibility;
  onChange: (visibility: Visibility) => void;
  onOpenChange?: (open: boolean) => void;
  /** Render only the visibility icon + chevron (tight comment sidebar toolbar). */
  iconOnly?: boolean;
}
