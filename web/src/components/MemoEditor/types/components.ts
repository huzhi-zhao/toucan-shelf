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
}

export interface EditorContentProps {
  placeholder?: string;
  expand?: boolean;
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
}

export interface EditorMetadataProps {
  memoName?: string;
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
