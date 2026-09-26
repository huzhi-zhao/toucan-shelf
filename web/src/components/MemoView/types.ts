import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

export interface MemoViewProps {
  memo: Memo;
  compact?: boolean;
  /** Fold content taller than the trigger height, regardless of the `compact` display setting. */
  autoFold?: boolean;
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  className?: string;
  parentPage?: string;
  shareImageDialogOpen?: boolean;
  onShareImageDialogOpenChange?: (open: boolean) => void;
  /** Only meaningful together with `compact={false}` (memo detail page): toggles the right sidebar. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /**
   * Let the inline editor take the rest of the screen instead of the fixed cap
   * it gets in a feed. For the detail page, where the memo is the page rather
   * than one card among many — in a list a tall editor would swallow everything
   * below it.
   */
  fillViewportEditor?: boolean;
  /** Fired whenever the inline editor opens/closes (e.g. so a sibling outline sidebar knows to switch sources). */
  onEditingChange?: (editing: boolean) => void;
  /** Fired with the live editor draft on every change, and with `null` when the editor closes. */
  onDraftContentChange?: (content: string | null) => void;
}

export interface MemoHeaderProps {
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  compact?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export interface MemoBodyProps {
  compact?: boolean;
  autoFold?: boolean;
}
