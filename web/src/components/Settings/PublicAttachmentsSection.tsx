// "我公开的附件" — the one place that answers "which of my files did I put on the
// open internet, and how do I take one back?".
//
// Without it the public-link feature is write-only: the flag is set from a ⋮ menu
// buried in whichever document holds the file, so six months later there is no way
// to find what you published short of opening every document you own. See
// docs/dev/requirements/attachments/access-control-and-private-files.md, part C.

import copy from "copy-to-clipboard";
import { ExternalLinkIcon, GlobeIcon, LinkIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/contexts/InstanceContext";
import { useSetAttachmentAccess } from "@/hooks/useAttachmentAccess";
import { useInfiniteAttachments } from "@/hooks/useAttachmentQueries";
import { type Attachment, AttachmentAccess } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentThumbnailUrl, getAttachmentUrl } from "@/utils/attachment";
import { formatFileSize } from "@/utils/format";
import { useTranslate } from "@/utils/i18n";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

// Server-side CEL over AttachmentPayload.access (internal/filter NewAttachmentSchema).
// Listing every attachment and filtering client-side would page through a user's
// entire upload history to find the handful that are public.
const PUBLIC_FILTER = `access == "ACCESS_PUBLIC"`;

const isImage = (attachment: Attachment) => attachment.type.startsWith("image/");

const PublicAttachmentRow = ({ attachment, origin }: { attachment: Attachment; origin: string }) => {
  const t = useTranslate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutateAsync: setAccess, isPending } = useSetAttachmentAccess();
  const publicUrl = `${origin}${getAttachmentUrl(attachment)}`;
  const memoUid = attachment.memo?.split("/").pop();

  const handleCopy = () => {
    copy(publicUrl);
    toast.success(t("attachment.public.copy-success"));
  };

  const handleRevoke = async () => {
    try {
      await setAccess({ name: attachment.name, access: AttachmentAccess.ACCESS_INHERIT });
      toast.success(t("setting.public-attachment.revoke-success"));
    } catch {
      toast.error(t("attachment.public.error"));
    }
  };

  return (
    <>
      <SettingListItem
        icon={
          isImage(attachment) ? (
            <img
              src={getAttachmentThumbnailUrl(attachment)}
              alt={attachment.filename}
              className="h-9 w-9 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <GlobeIcon className="h-5 w-5" />
          )
        }
        label={<span className="block truncate">{attachment.filename}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{attachment.size ? formatFileSize(Number(attachment.size)) : ""}</span>
            {/* The link back to the holding document is what makes an unfamiliar
                filename identifiable; an attachment with no memo is simply orphaned. */}
            {memoUid && (
              <Link to={`/memos/${memoUid}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLinkIcon className="h-3 w-3" />
                {t("setting.public-attachment.open-document")}
              </Link>
            )}
          </span>
        }
        controlClassName="gap-2"
      >
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          <LinkIcon className="h-4 w-4" />
          {t("attachment.public.copy-link")}
        </Button>
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => setConfirmOpen(true)}>
          {t("setting.public-attachment.revoke")}
        </Button>
      </SettingListItem>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("setting.public-attachment.revoke-confirm-title")}
        description={t("setting.public-attachment.revoke-confirm-description", { filename: attachment.filename })}
        confirmLabel={t("setting.public-attachment.revoke")}
        cancelLabel={t("common.cancel")}
        confirmVariant="destructive"
        onConfirm={handleRevoke}
      />
    </>
  );
};

const PublicAttachmentsSection = () => {
  const t = useTranslate();
  const { profile } = useInstance();
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteAttachments({
    filter: PUBLIC_FILTER,
  });

  const attachments = data?.pages.flatMap((page) => page.attachments) ?? [];
  // Same fallback the ⋮ menu uses: without InstanceURL the server refuses to serve
  // these bytes anonymously at all (决策 6), so the origin here is only good for
  // recognising the file, not for handing the link to anyone.
  const origin = profile.instanceUrl || window.location.origin;

  return (
    <SettingSection title={t("setting.public-attachment.title")} description={t("setting.public-attachment.description")}>
      {!profile.instanceUrl && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          {t("setting.public-attachment.no-instance-url")}
        </p>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t("setting.public-attachment.load-error")}</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("setting.public-attachment.empty")}</p>
      ) : (
        <>
          <SettingList>
            {attachments.map((attachment) => (
              <PublicAttachmentRow key={attachment.name} attachment={attachment} origin={origin} />
            ))}
          </SettingList>
          {hasNextPage && (
            <Button variant="outline" size="sm" className="self-start" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {t("memo.load-more")}
            </Button>
          )}
        </>
      )}
    </SettingSection>
  );
};

export default PublicAttachmentsSection;
