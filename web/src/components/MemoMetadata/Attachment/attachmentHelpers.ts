import { type Attachment, AttachmentAccess } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentType } from "@/utils/attachment";
import { formatFileSize, getFileTypeLabel } from "@/utils/format";

export interface AttachmentGroups {
  visual: Attachment[];
  audio: Attachment[];
  docs: Attachment[];
  locked: Attachment[];
}

export interface AttachmentMetadata {
  fileTypeLabel: string;
  fileSizeLabel?: string;
}

export const isLockedAttachment = (attachment: Attachment): boolean => attachment.access === AttachmentAccess.ACCESS_LOCKED;
export const isPublicAttachment = (attachment: Attachment): boolean => attachment.access === AttachmentAccess.ACCESS_PUBLIC;
export const isImageAttachment = (attachment: Attachment): boolean => getAttachmentType(attachment) === "image/*";
export const isVideoAttachment = (attachment: Attachment): boolean => getAttachmentType(attachment) === "video/*";
export const isAudioAttachment = (attachment: Attachment): boolean => getAttachmentType(attachment) === "audio/*";
export const isPdfAttachment = (attachment: Attachment): boolean => getAttachmentType(attachment) === "application/pdf";
export const isHtmlAttachment = (attachment: Attachment): boolean => attachment.type === "text/html";
export const isEpubAttachment = (attachment: Attachment): boolean => getAttachmentType(attachment) === "application/epub+zip";
export const isPreviewableAttachment = (attachment: Attachment): boolean =>
  isPdfAttachment(attachment) || isHtmlAttachment(attachment) || isEpubAttachment(attachment);

// A locked attachment is pulled out before any media-type classification, so it
// never enters the visual gallery / audio player / previewable-doc paths — those
// all assume the attachment's bytes are actually fetchable, which a locked one's
// aren't until the vault is open. See LockedAttachmentRow for the one place a
// locked attachment's content becomes reachable.
export const separateAttachments = (attachments: Attachment[]): AttachmentGroups => {
  return attachments.reduce<AttachmentGroups>(
    (groups, attachment) => {
      if (isLockedAttachment(attachment)) {
        groups.locked.push(attachment);
      } else if (isImageAttachment(attachment) || isVideoAttachment(attachment)) {
        groups.visual.push(attachment);
      } else if (isAudioAttachment(attachment)) {
        groups.audio.push(attachment);
      } else {
        groups.docs.push(attachment);
      }

      return groups;
    },
    {
      visual: [],
      audio: [],
      docs: [],
      locked: [],
    },
  );
};

export const getAttachmentMetadata = (attachment: Attachment): AttachmentMetadata => ({
  fileTypeLabel: getFileTypeLabel(attachment.type),
  fileSizeLabel: attachment.size ? formatFileSize(Number(attachment.size)) : undefined,
});

export const formatAudioTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};
