import { Code, ConnectError } from "@connectrpc/connect";
import copy from "copy-to-clipboard";
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  GlobeIcon,
  GlobeLockIcon,
  LockIcon,
  MoreVerticalIcon,
  PaperclipIcon,
  PlayIcon,
} from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import MetadataSection from "@/components/MemoMetadata/MetadataSection";
import MotionPhotoPreview from "@/components/MotionPhotoPreview";
import UnlockMasterKeyDialog from "@/components/Secret/UnlockMasterKeyDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VideoPoster from "@/components/VideoPoster";
import { useInstance } from "@/contexts/InstanceContext";
import { extractAttachmentUidFromName } from "@/helpers/resource-names";
import { useSetAttachmentAccess } from "@/hooks/useAttachmentAccess";
import { cn } from "@/lib/utils";
import { type Attachment, AttachmentAccess } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import type { AttachmentVisualItem, PreviewMediaItem } from "@/utils/media-item";
import { buildAttachmentVisualItems } from "@/utils/media-item";
import AudioAttachmentItem from "./AudioAttachmentItem";
import {
  getAttachmentMetadata,
  isAudioAttachment,
  isPreviewableAttachment,
  isPublicAttachment,
  separateAttachments,
} from "./attachmentHelpers";
import {
  COLLAGE_VIDEO_PLAY_BADGE_CLASS,
  COVER_MEDIA_CLASS,
  MEDIA_HOVER_GRADIENT_CLASS,
  MEDIA_HOVER_SURFACE_CLASS,
  NATURAL_MEDIA_CLASS,
  OVERFLOW_TILE_OVERLAY_CLASS,
  SINGLE_MOTION_VIDEO_CLASS,
  SINGLE_VIDEO_CARD_WIDTH_CLASS,
  VISUAL_TILE_BUTTON_CLASS,
} from "./attachmentVisualClasses";
import LockedAttachmentRow from "./LockedAttachmentRow";
import { resolveVisualGalleryLayout } from "./visualGalleryLayout";

interface AttachmentListViewProps {
  attachments: Attachment[];
  onImagePreview?: (items: PreviewMediaItem[], index: number) => void;
}

type VisualItem = AttachmentVisualItem;

const AttachmentMeta = ({ attachment }: { attachment: Attachment }) => {
  const { fileTypeLabel, fileSizeLabel } = getAttachmentMetadata(attachment);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>{fileTypeLabel}</span>
      {fileSizeLabel && (
        <>
          <span className="text-muted-foreground/40">•</span>
          <span>{fileSizeLabel}</span>
        </>
      )}
    </div>
  );
};

const DocumentItem = ({ attachment }: { attachment: Attachment }) => {
  const previewable = isPreviewableAttachment(attachment);
  const ActionIcon = previewable ? ExternalLinkIcon : DownloadIcon;

  return (
    <div className="group flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/65 px-3 py-2.5 transition-colors hover:bg-accent/20">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
          <FileIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium leading-tight text-foreground" title={attachment.filename}>
            {attachment.filename}
          </div>
          <AttachmentMeta attachment={attachment} />
        </div>
      </div>
      <ActionIcon className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground/70" />
    </div>
  );
};

const getMotionPreviewProps = (item: VisualItem) => ({
  motionUrl: item.previewItem.kind === "motion" ? item.previewItem.motionUrl : item.sourceUrl,
  presentationTimestampUs: item.previewItem.kind === "motion" ? item.previewItem.presentationTimestampUs : undefined,
});

const VisualTile = ({
  className,
  onPreview,
  overlayLabel,
  actions,
  children,
}: PropsWithChildren<{ className?: string; onPreview?: () => void; overlayLabel?: string; actions?: ReactNode }>) => {
  return (
    <div className={cn("group", VISUAL_TILE_BUTTON_CLASS, className)} onClick={onPreview}>
      <div className={MEDIA_HOVER_SURFACE_CLASS}>
        {children}
        <div className={MEDIA_HOVER_GRADIENT_CLASS} aria-hidden />
      </div>
      {overlayLabel && <div className={OVERFLOW_TILE_OVERLAY_CLASS}>{overlayLabel}</div>}
      {/* The tile itself is the preview trigger, so the menu has to stop the click
          from reaching it — otherwise every menu interaction also opens the lightbox. */}
      {actions && (
        <div className="absolute right-1 top-1 z-10" onClick={(event) => event.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
};

// Marks a tile whose file is readable by anyone holding its URL, so "this image is
// on the open internet" is visible without opening a menu to find out.
const PublicBadge = ({ label }: { label: string }) => (
  <span
    className="pointer-events-none absolute left-1 top-1 z-10 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
    title={label}
  >
    <GlobeIcon className="h-3 w-3" />
    {label}
  </span>
);

const VideoPlayBadge = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <span
    className={cn(
      "pointer-events-none absolute inline-flex items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur-sm",
      className,
    )}
  >
    {children}
  </span>
);

// The gallery renders media items, not attachments — a motion photo is one tile over
// two files. Per-attachment actions only make sense where those coincide, so a motion
// pair gets no menu rather than a menu that silently publishes half of it; its files
// are still reachable from the attachment list below.
const useVisualTileExtras = (item: VisualItem) => {
  const t = useTranslate();
  const attachment = item.attachments.length === 1 ? item.attachments[0] : undefined;
  if (!attachment) {
    return { actions: undefined, badge: undefined };
  }
  return {
    actions: (
      <AttachmentActionsMenu
        attachment={attachment}
        className="h-7 w-7 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      />
    ),
    badge: isPublicAttachment(attachment) ? <PublicBadge label={t("attachment.public.badge")} /> : undefined,
  };
};

const CollageVisualItem = ({
  item,
  onPreview,
  className,
  overlayLabel,
}: {
  item: VisualItem;
  onPreview?: () => void;
  className?: string;
  overlayLabel?: string;
}) => {
  const motionPreviewProps = item.kind === "motion" ? getMotionPreviewProps(item) : undefined;
  const { actions, badge } = useVisualTileExtras(item);

  return (
    <VisualTile className={cn("block h-full w-full", className)} onPreview={onPreview} overlayLabel={overlayLabel} actions={actions}>
      {badge}
      {item.kind === "video" ? (
        <>
          <VideoPoster sourceUrl={item.sourceUrl} posterUrl={item.posterUrl} alt={item.filename} className={COVER_MEDIA_CLASS} />
          {!overlayLabel && (
            <VideoPlayBadge className={COLLAGE_VIDEO_PLAY_BADGE_CLASS}>
              <PlayIcon className="h-3.5 w-3.5 fill-current" />
            </VideoPlayBadge>
          )}
        </>
      ) : item.kind === "motion" && motionPreviewProps ? (
        <MotionPhotoPreview
          posterUrl={item.posterUrl}
          motionUrl={motionPreviewProps.motionUrl}
          alt={item.filename}
          presentationTimestampUs={motionPreviewProps.presentationTimestampUs}
          containerClassName="h-full w-full"
          badgeClassName="left-2 top-2 px-2 py-0.5 text-[10px]"
          mediaClassName={COVER_MEDIA_CLASS}
        />
      ) : (
        <img src={item.posterUrl} alt={item.filename} className={COVER_MEDIA_CLASS} loading="lazy" decoding="async" />
      )}
    </VisualTile>
  );
};

const SingleVisualItem = ({ item, onPreview }: { item: VisualItem; onPreview?: () => void }) => {
  const motionPreviewProps = item.kind === "motion" ? getMotionPreviewProps(item) : undefined;
  const { actions, badge } = useVisualTileExtras(item);

  if (item.kind === "image") {
    return (
      <VisualTile className="inline-block max-w-full" onPreview={onPreview} actions={actions}>
        {badge}
        <img src={item.posterUrl} alt={item.filename} className={NATURAL_MEDIA_CLASS} loading="lazy" decoding="async" />
      </VisualTile>
    );
  }

  if (item.kind === "motion" && motionPreviewProps) {
    return (
      <VisualTile className="inline-block max-w-full" onPreview={onPreview} actions={actions}>
        {badge}
        <MotionPhotoPreview
          posterUrl={item.posterUrl}
          motionUrl={motionPreviewProps.motionUrl}
          alt={item.filename}
          presentationTimestampUs={motionPreviewProps.presentationTimestampUs}
          containerClassName="max-w-full"
          posterClassName={cn(NATURAL_MEDIA_CLASS, "object-contain")}
          videoClassName={SINGLE_MOTION_VIDEO_CLASS}
          badgeClassName="left-2 top-2 px-2 py-0.5 text-[10px]"
        />
      </VisualTile>
    );
  }

  return (
    <VisualTile className={cn("block", SINGLE_VIDEO_CARD_WIDTH_CLASS)} onPreview={onPreview} actions={actions}>
      {badge}
      <div className="relative aspect-video bg-black/5">
        <VideoPoster sourceUrl={item.sourceUrl} posterUrl={item.posterUrl} alt={item.filename} className={COVER_MEDIA_CLASS} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
        <VideoPlayBadge className="bottom-3 right-3 h-9 w-9">
          <PlayIcon className="h-4 w-4 fill-current" />
        </VideoPlayBadge>
      </div>
    </VisualTile>
  );
};

const VisualGallery = ({ items, onPreview }: { items: VisualItem[]; onPreview?: (itemId: string) => void }) => {
  const layout = resolveVisualGalleryLayout(items);

  if (!layout) {
    return null;
  }

  if (layout.mode === "single") {
    return (
      <div className="w-full">
        <SingleVisualItem item={layout.item} onPreview={() => onPreview?.(layout.item.id)} />
      </div>
    );
  }

  return (
    <div className={layout.containerClassName}>
      {layout.cells.map(({ item, className, overlayLabel }) => (
        <CollageVisualItem
          key={item.id}
          item={item}
          className={className}
          overlayLabel={overlayLabel}
          onPreview={() => onPreview?.(item.id)}
        />
      ))}
    </div>
  );
};

const AudioList = ({ attachments, compact = false }: { attachments: Attachment[]; compact?: boolean }) => (
  <div className={cn("gap-2", compact ? "grid grid-cols-1 sm:grid-cols-2" : "flex flex-col")}>
    {attachments.map((attachment) => (
      <AudioAttachmentItem
        key={attachment.name}
        filename={attachment.filename}
        sourceUrl={getAttachmentUrl(attachment)}
        mimeType={attachment.type}
        size={Number(attachment.size)}
        compact={compact}
      />
    ))}
  </div>
);

// Trailing "⋮" menu for an attachment row. Offers copying the inline markdown
// reference (`![filename](/file/attachments/…/name.ext)`) so the file can be
// embedded into another document's content, and downloading the file.
const AttachmentActionsMenu = ({ attachment, className }: { attachment: Attachment; className?: string }) => {
  const t = useTranslate();
  const { profile } = useInstance();
  const { mutateAsync: setAccess, isPending: accessPending } = useSetAttachmentAccess();
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const isPublic = isPublicAttachment(attachment);

  const handleCopyMdReference = () => {
    copy(`![${attachment.filename}](${getAttachmentUrl(attachment)})`);
    toast.success(t("gallery.copy-md-reference-success"));
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = getAttachmentUrl(attachment);
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // "设为私密" locks an attachment down to its creator's own unlocked vault. The
  // server refuses with FailedPrecondition when the creator has no
  // unlock_verifier on file yet (server/router/api/v1/vault_service.go's
  // canLockAttachment) — R8, "never lock behind a passphrase you can't yet
  // prove you hold". The full inline unlock-and-retry flow lives in
  // LockedAttachmentRow; here a locked attachment is one that's already
  // succeeded, so the only failure worth guiding is this one.
  // The public link has to be absolute to be worth copying — it is going into a blog
  // post or a chat window, not back into this app. `instanceUrl` is also what decides
  // whether the server will accept the flag at all (决策 6), so an instance without one
  // hides the entry instead of offering a link that would 401.
  const publicLinkOrigin = profile.instanceUrl || window.location.origin;

  const handleCopyPublicLink = () => {
    copy(`${publicLinkOrigin}${getAttachmentUrl(attachment)}`);
    toast.success(t("attachment.public.copy-success"));
  };

  const handleTogglePublic = async () => {
    try {
      await setAccess({
        name: attachment.name,
        access: isPublic ? AttachmentAccess.ACCESS_INHERIT : AttachmentAccess.ACCESS_PUBLIC,
      });
      if (!isPublic) {
        handleCopyPublicLink();
      }
    } catch {
      toast.error(t("attachment.public.error"));
    }
  };

  const handleToggleLocked = async () => {
    try {
      await setAccess({ name: attachment.name, access: AttachmentAccess.ACCESS_LOCKED });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
        // The account has never unlocked its master passphrase in this tab (or
        // ever, for accounts with no encrypted block to trigger it), so the
        // server has no unlock_verifier on file yet. Offer the unlock dialog
        // directly instead of leaving the user to hunt for one.
        setUnlockDialogOpen(true);
        return;
      }
      toast.error(t("attachment.vault.lock-error"));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("shrink-0 text-muted-foreground/60 hover:text-foreground/70", className)}
            title={t("common.more")}
          >
            <MoreVerticalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleDownload}>
            <DownloadIcon className="h-4 w-4" />
            {t("gallery.download")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyMdReference}>{t("gallery.copy-md-reference")}</DropdownMenuItem>
          {profile.instanceUrl !== "" && (
            <DropdownMenuItem onClick={handleTogglePublic} disabled={accessPending}>
              {isPublic ? <GlobeLockIcon className="h-4 w-4" /> : <GlobeIcon className="h-4 w-4" />}
              {isPublic ? t("attachment.public.make-private") : t("attachment.public.make-public")}
            </DropdownMenuItem>
          )}
          {isPublic && <DropdownMenuItem onClick={handleCopyPublicLink}>{t("attachment.public.copy-link")}</DropdownMenuItem>}
          {!isPublic && (
            <DropdownMenuItem onClick={handleToggleLocked} disabled={accessPending}>
              <LockIcon className="h-4 w-4" />
              {t("attachment.vault.make-private")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <UnlockMasterKeyDialog
        open={unlockDialogOpen}
        onOpenChange={setUnlockDialogOpen}
        onUnlocked={async () => {
          try {
            await setAccess({ name: attachment.name, access: AttachmentAccess.ACCESS_LOCKED });
          } catch {
            toast.error(t("attachment.vault.lock-error"));
          }
        }}
      />
    </>
  );
};

const DocsList = ({ attachments }: { attachments: Attachment[] }) => (
  <div className="flex flex-col gap-2">
    {attachments.map((attachment) => (
      <div key={attachment.name} className="flex items-center gap-1">
        {isPreviewableAttachment(attachment) ? (
          <a
            className="min-w-0 flex-1"
            href={`/attachments/${extractAttachmentUidFromName(attachment.name)}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Preview ${attachment.filename}`}
          >
            <DocumentItem attachment={attachment} />
          </a>
        ) : (
          <a className="min-w-0 flex-1" href={getAttachmentUrl(attachment)} download title={`Download ${attachment.filename}`}>
            <DocumentItem attachment={attachment} />
          </a>
        )}
        <AttachmentActionsMenu attachment={attachment} />
      </div>
    ))}
  </div>
);

const Divider = () => <div className="border-t border-border/70 opacity-80" />;

const LockedList = ({ attachments }: { attachments: Attachment[] }) => (
  <div className="flex flex-col gap-2">
    {attachments.map((attachment) => (
      <LockedAttachmentRow key={attachment.name} attachment={attachment} />
    ))}
  </div>
);

const AttachmentListView = ({ attachments, onImagePreview }: AttachmentListViewProps) => {
  const { visual, audio, docs, locked } = useMemo(() => separateAttachments(attachments), [attachments]);
  const visualItems = useMemo(() => buildAttachmentVisualItems(visual), [visual]);
  const previewItems = useMemo(() => visualItems.map((item) => item.previewItem), [visualItems]);
  const hasVisual = visualItems.length > 0;
  const hasAudio = audio.length > 0;
  const hasDocs = docs.length > 0;
  const hasLocked = locked.length > 0;
  const hasMedia = hasVisual || hasAudio;

  if (attachments.length === 0) {
    return null;
  }

  const handlePreview = (itemId: string) => {
    const index = previewItems.findIndex((item) => item.id === itemId);
    onImagePreview?.(previewItems, index >= 0 ? index : 0);
  };

  return (
    <MetadataSection
      icon={PaperclipIcon}
      title="Attachments"
      count={visualItems.length + audio.length + docs.length + locked.length}
      contentClassName="flex flex-col gap-2 p-2"
    >
      {hasMedia && (
        <div className="flex flex-col gap-2">
          {hasVisual && <VisualGallery items={visualItems} onPreview={handlePreview} />}
          {hasAudio && <AudioList attachments={audio.filter(isAudioAttachment)} compact />}
        </div>
      )}
      {hasMedia && hasDocs && <Divider />}
      {hasDocs && <DocsList attachments={docs} />}
      {(hasMedia || hasDocs) && hasLocked && <Divider />}
      {hasLocked && <LockedList attachments={locked} />}
    </MetadataSection>
  );
};

export default AttachmentListView;
