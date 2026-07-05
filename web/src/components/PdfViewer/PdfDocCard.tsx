import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { FileTextIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  title: string;
  memoName: string;
  attachment?: Attachment;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

// Compact PDF summary shown in memo lists (e.g. /explore) instead of an inline viewer — the
// full PdfViewer is reserved for the memo detail page since rendering a canvas per list card
// would be expensive and mostly off-screen.
export const PdfDocCard = ({ title, memoName, attachment }: Props) => {
  const t = useTranslate();

  return (
    <div className="w-full flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <FileTextIcon className="w-8 h-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {attachment ? formatBytes(Number(attachment.size)) : ""}
          {attachment?.createTime && ` · ${dayjs(timestampDate(attachment.createTime)).format("YYYY-MM-DD")}`}
        </div>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to={`/${memoName}`}>{t("pdf.view-details")}</Link>
      </Button>
    </div>
  );
};
