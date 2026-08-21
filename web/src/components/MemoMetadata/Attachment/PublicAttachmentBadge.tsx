import copy from "copy-to-clipboard";
import { GlobeIcon } from "lucide-react";
import toast from "react-hot-toast";
import { useInstance } from "@/contexts/InstanceContext";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { VISUAL_Z } from "./attachmentVisualClasses";

// Marks a piece of media whose file is readable by anyone holding its URL, so "this
// image is on the open internet" is visible without opening a menu to find out.
// Clicking it copies that URL — outside the editor this badge is the only place the
// public link is reachable at all.
//
// Deliberately quiet: a bare globe in the corner, faded in on hover, because most
// media is not public and a permanent labelled pill would tax every image to annotate
// a few. The label survives as the tooltip. Note this leaves the badge unreachable on
// touch, where there is no hover — the editor's access menu stays the authoritative
// readout.
//
// The hover trigger is `group/media`, which the caller must put on the positioned
// ancestor: the attachment gallery already scopes its hover that way
// (attachmentVisualClasses), so the badge fades in together with the tile's gradient
// rather than on its own timing.
const PublicAttachmentBadge = ({ attachment, label }: { attachment: Attachment; label: string }) => {
  const t = useTranslate();
  const { profile } = useInstance();

  return (
    <button
      type="button"
      // The surrounding media is usually a lightbox trigger, so the click must stop
      // here — otherwise copying the link also opens the preview over it.
      onClick={(event) => {
        event.stopPropagation();
        // A public attachment is worth an absolute URL, but a link that only works on
        // this origin still beats copying nothing when instanceUrl is unset.
        copy(`${profile.instanceUrl || window.location.origin}${getAttachmentUrl(attachment)}`);
        toast.success(t("attachment.public.copy-success"));
      }}
      className={cn(
        "absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full",
        "bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm",
        "transition-opacity hover:text-foreground",
        // Invisible must also mean unclickable, or the corner of every public tile
        // swallows clicks meant for the preview.
        "pointer-events-none opacity-0 group-hover/media:pointer-events-auto group-hover/media:opacity-100",
        VISUAL_Z.badge,
      )}
      title={t("attachment.public.copy-link")}
      aria-label={label}
    >
      <GlobeIcon className="h-2.5 w-2.5" />
    </button>
  );
};

// Wraps a single inline media element so the badge has something positioned to sit in.
// `inline-block` with no width of its own keeps the frame on the media's own box —
// anything wider would strand the badge beside a narrow or centered picture. Renders the
// child untouched when there is nothing to mark, so private media keeps its exact DOM.
export const PublicMediaFrame = ({ attachment, children }: { attachment: Attachment | undefined; children: React.ReactNode }) => {
  const t = useTranslate();

  if (!attachment) {
    return <>{children}</>;
  }

  return (
    <span className="group/media relative inline-block max-w-full leading-none">
      {children}
      <PublicAttachmentBadge attachment={attachment} label={t("attachment.public.badge")} />
    </span>
  );
};

export default PublicAttachmentBadge;
