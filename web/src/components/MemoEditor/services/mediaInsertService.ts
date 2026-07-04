import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl, isImage, isMediaMimeType } from "@/utils/attachment";

/** Splits files into ones that should be inlined into content vs. kept as attachments. */
export function splitMediaFiles(files: File[]): { media: File[]; others: File[] } {
  const media: File[] = [];
  const others: File[] = [];
  for (const file of files) {
    (isMediaMimeType(file.type) ? media : others).push(file);
  }
  return { media, others };
}

/** Builds the markdown reference inserted at the cursor for a freshly uploaded media attachment. */
export function buildMediaMarkdown(attachment: Attachment): string {
  const url = getAttachmentUrl(attachment);
  return isImage(attachment.type) ? `![${attachment.filename}](${url})` : `[${attachment.filename}](${url})`;
}
