import { LayoutGridIcon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, isImage } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { type GalleryViewConfig, parseGalleryViewConfig } from "./types";

interface Props {
  memo: Memo;
  /** How a card click opens the target document. Defaults to navigating to the memo detail page. */
  onOpenDoc?: (memoName: string) => void;
  className?: string;
}

// Pulls the first markdown image URL out of a document's content, used as a
// cover fallback when the doc has no image attachment.
const firstMarkdownImage = (content: string): string | undefined => {
  const match = content.match(/!\[[^\]]*\]\(([^)\s]+)/);
  return match?.[1];
};

const coverUrl = (doc: Memo, config: GalleryViewConfig): string | undefined => {
  if (config.cover === "none") return undefined;
  const imageAttachment = doc.attachments.find((a) => isImage(a.type));
  if (imageAttachment) return getAttachmentThumbnailUrl(imageAttachment);
  if (doc.docType === Memo_DocType.MARKDOWN) return firstMarkdownImage(doc.content);
  return undefined;
};

const sortDocs = (docs: Memo[], config: GalleryViewConfig): Memo[] => {
  const ts = (t?: { seconds: bigint }) => Number(t?.seconds ?? 0n);
  const sorted = [...docs];
  switch (config.sort) {
    case "updated_asc":
      return sorted.sort((a, b) => ts(a.updateTime) - ts(b.updateTime));
    case "created_desc":
      return sorted.sort((a, b) => ts(b.createTime) - ts(a.createTime));
    case "created_asc":
      return sorted.sort((a, b) => ts(a.createTime) - ts(b.createTime));
    case "title_asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return sorted.sort((a, b) => ts(b.updateTime) - ts(a.updateTime));
  }
};

// Renders a VIEW document: optional markdown intro on top (existing markdown
// pipeline, including sanitization), then a gallery card wall built by
// querying the scope's documents live — nothing is generated or cached.
const GalleryViewRenderer = ({ memo, onOpenDoc, className }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const config = parseGalleryViewConfig(memo.content);

  const scopeFilter =
    config?.scope.type === "tag" ? `tag in [${JSON.stringify(config.scope.tag)}]` : `workspace == ${JSON.stringify(memo.workspace)}`;

  const { data, isLoading } = useMemos(
    config
      ? {
          pageSize: 1000,
          state: State.NORMAL,
          filter: scopeFilter,
        }
      : {},
  );

  const docs = useMemo(() => {
    if (!config) return [];
    let list = (data?.memos ?? []).filter((m) => m.name !== memo.name && m.docType !== Memo_DocType.VIEW);
    if (config.scope.type === "folder") {
      list = list.filter((m) => m.workspace === memo.workspace && m.folderPath === memo.folderPath);
    }
    return sortDocs(list, config);
  }, [data, config, memo.name, memo.workspace, memo.folderPath]);

  if (!config) {
    return <div className={cn("text-sm text-muted-foreground", className)}>{t("gallery.not-configured")}</div>;
  }

  const openDoc = onOpenDoc ?? ((name: string) => navigate(`/${name}`));

  return (
    <div className={cn("w-full flex flex-col gap-4", className)}>
      {config.description && <MemoContent content={config.description} memoName={memo.name} />}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("gallery.loading")}</div>
      ) : docs.length === 0 ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <LayoutGridIcon className="w-4 h-4" />
          {t("gallery.empty")}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {docs.map((doc) => {
            const cover = coverUrl(doc, config);
            return (
              <button
                key={doc.name}
                type="button"
                className="flex flex-col rounded-lg border border-border overflow-hidden text-left bg-card hover:shadow-md hover:border-accent transition-all"
                onClick={() => openDoc(doc.name)}
              >
                <div className="w-full aspect-[16/10] bg-muted flex items-center justify-center overflow-hidden">
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <LayoutGridIcon className="w-8 h-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="text-sm font-medium truncate">{doc.title || doc.name}</div>
                  {doc.updateTime && (
                    <div className="text-xs text-muted-foreground">
                      {new Date(Number(doc.updateTime.seconds) * 1000).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GalleryViewRenderer;
