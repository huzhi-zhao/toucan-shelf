import { cn } from "@/lib/utils";
import type { MemoHistory } from "@/types/proto/api/v1/memo_service_pb";
import { MemoHistory_Source } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/**
 * The name of a version as it appears in the version list.
 *
 * Automatic versions are never named by anyone — auto-save writes them on its
 * own — so they get a generic label in muted text. That contrast is what tells
 * a reader which entries they chose to keep and which ones the editor kept for
 * them, and it matters because only the automatic ones expire.
 */
export const MemoVersionLabel = ({ history, className }: { history: MemoHistory; className?: string }) => {
  const t = useTranslate();
  const isAuto = history.source === MemoHistory_Source.AUTO;

  if (isAuto && !history.displayName) {
    return <span className={cn("text-sm text-muted-foreground", className)}>{t("memo.auto-saved-version")}</span>;
  }
  return <span className={cn("text-sm", className)}>{history.displayName || t("memo.unnamed-version")}</span>;
};
