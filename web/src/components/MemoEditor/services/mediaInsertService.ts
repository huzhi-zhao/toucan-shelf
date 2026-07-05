import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl, isMediaMimeType } from "@/utils/attachment";

/** Splits files into ones that should be inlined into content vs. kept as attachments. */
export function splitMediaFiles(files: File[]): { media: File[]; others: File[] } {
  const media: File[] = [];
  const others: File[] = [];
  for (const file of files) {
    (isMediaMimeType(file.type) ? media : others).push(file);
  }
  return { media, others };
}

/**
 * Builds the markdown reference inserted at the cursor for a freshly uploaded media
 * attachment. Image/video/audio all use the `![]()` image syntax — the markdown renderer
 * (MemoContent/markdown) tells them apart by the attachment's mime type/extension and
 * renders an <img>/<video>/<audio> accordingly.
 */
export function buildMediaMarkdown(attachment: Attachment): string {
  const url = getAttachmentUrl(attachment);
  // Square brackets in the filename would terminate the `![alt]` segment early.
  const alt = attachment.filename.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `![${alt}](${url})`;
}
