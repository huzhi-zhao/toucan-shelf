import { Attachment, AttachmentOrigin, MotionMediaFamily, MotionMediaRole } from "@/types/proto/api/v1/attachment_service_pb";

// Encodes the filename path segment of an attachment URL. Beyond encodeURIComponent,
// also escapes parentheses (which it leaves alone) because the URL gets embedded in
// markdown `![](...)` syntax, where an unescaped `)` terminates the link.
const encodeAttachmentFilename = (filename: string) => encodeURIComponent(filename).replace(/\(/g, "%28").replace(/\)/g, "%29");

// Root-relative (no origin/protocol) so the URL counts as "local" under the markdown
// renderer's sanitize schema (MemoContent/constants.ts restricts `src` to the https
// protocol) — an absolute http:// URL gets its src attribute stripped by rehype-sanitize
// on any non-https deployment (e.g. local dev, plain-http self-hosting).
export const getAttachmentUrl = (attachment: Attachment) => {
  if (attachment.externalLink) {
    return attachment.externalLink;
  }

  return `/file/${attachment.name}/${encodeAttachmentFilename(attachment.filename)}`;
};

export const getAttachmentThumbnailUrl = (attachment: Attachment) => {
  return `/file/${attachment.name}/${encodeAttachmentFilename(attachment.filename)}?thumbnail=true`;
};

export const getAttachmentMotionClipUrl = (attachment: Attachment) => {
  return `/file/${attachment.name}/${encodeAttachmentFilename(attachment.filename)}?motion=true`;
};

export const getAttachmentType = (attachment: Attachment) => {
  if (isImage(attachment.type)) {
    return "image/*";
  } else if (attachment.type.startsWith("video")) {
    return "video/*";
  } else if (attachment.type.startsWith("audio") && !isMidiFile(attachment.type)) {
    return "audio/*";
  } else if (attachment.type.startsWith("text")) {
    return "text/*";
  } else if (attachment.type.startsWith("application/epub+zip")) {
    return "application/epub+zip";
  } else if (attachment.type.startsWith("application/pdf")) {
    return "application/pdf";
  } else if (attachment.type.includes("word")) {
    return "application/msword";
  } else if (attachment.type.includes("excel")) {
    return "application/msexcel";
  } else if (attachment.type.startsWith("application/zip")) {
    return "application/zip";
  } else if (attachment.type.startsWith("application/x-java-archive")) {
    return "application/x-java-archive";
  } else {
    return "application/octet-stream";
  }
};

// isImage returns true if the given mime type is an image.
export const isImage = (t: string) => {
  // Don't show PSDs as images.
  return t.startsWith("image/") && !isPSD(t);
};

// isMediaMimeType returns true for image/video/audio mime types — the set that
// gets inlined into memo content as a markdown reference instead of the attachment area.
export const isMediaMimeType = (t: string) => t.startsWith("image/") || t.startsWith("video/") || t.startsWith("audio/");

// MAX_MEDIA_ATTACHMENT_SIZE_BYTES mirrors the backend's maxMediaAttachmentSizeBytes
// (server/router/api/v1/attachment_service.go) so oversized media files are rejected
// before upload instead of after a round trip.
export const MAX_MEDIA_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

const VIDEO_URL_EXTENSIONS = new Set(["mp4", "webm", "ogv"]);
const AUDIO_URL_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "weba"]);

/**
 * Classifies a markdown image-reference URL (`![]()`) by its file extension, so the
 * `img` render node can be redirected to a <video>/<audio> element instead. Extension-based
 * (not mime-type-based) because markdown `img` nodes only carry a URL, no mime type — and only
 * mp4/webm/ogv are covered for video, matching the browser-native playback support we rely on
 * (no transcoding) rather than trying to support every container format.
 */
export const getMediaKindFromUrl = (url: string | undefined): "image" | "video" | "audio" | undefined => {
  if (!url) return undefined;
  const path = url.split(/[?#]/)[0];
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  if (VIDEO_URL_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_URL_EXTENSIONS.has(ext)) return "audio";
  return "image";
};

/**
 * Splits attachments into ones referenced inline in the memo's markdown content via `![]()`
 * (rendered inline, so hidden from the attachment editor/list) vs. the rest. Prefers the
 * `origin` flag set at upload time (see mediaInsertService/uploadService); falls back to
 * content-string matching for attachments uploaded before that field existed.
 */
export const partitionInlinedAttachments = <T extends Attachment>(attachments: T[], content: string): { inlined: T[]; rest: T[] } => {
  const inlined: T[] = [];
  const rest: T[] = [];
  for (const attachment of attachments) {
    const isInlined =
      attachment.origin === AttachmentOrigin.INLINE ||
      (attachment.origin === AttachmentOrigin.ATTACHMENT_ORIGIN_UNSPECIFIED && content.includes(getAttachmentUrl(attachment)));
    (isInlined ? inlined : rest).push(attachment);
  }
  return { inlined, rest };
};

// isMidiFile returns true if the given mime type is a MIDI file.
export const isMidiFile = (mimeType: string): boolean => {
  return mimeType === "audio/midi" || mimeType === "audio/mid" || mimeType === "audio/x-midi" || mimeType === "application/x-midi";
};

const isPSD = (t: string) => {
  return t === "image/vnd.adobe.photoshop" || t === "image/x-photoshop" || t === "image/photoshop";
};

export const getAttachmentMotionGroupId = (attachment: Attachment): string | undefined => {
  return attachment.motionMedia?.groupId || undefined;
};

export const isAppleLivePhotoStill = (attachment: Attachment): boolean =>
  attachment.motionMedia?.family === MotionMediaFamily.APPLE_LIVE_PHOTO && attachment.motionMedia.role === MotionMediaRole.STILL;

export const isAppleLivePhotoVideo = (attachment: Attachment): boolean =>
  attachment.motionMedia?.family === MotionMediaFamily.APPLE_LIVE_PHOTO && attachment.motionMedia.role === MotionMediaRole.VIDEO;

export const isAndroidMotionContainer = (attachment: Attachment): boolean =>
  attachment.motionMedia?.family === MotionMediaFamily.ANDROID_MOTION_PHOTO &&
  attachment.motionMedia.role === MotionMediaRole.CONTAINER &&
  attachment.motionMedia.hasEmbeddedVideo;

export const isMotionAttachment = (attachment: Attachment): boolean =>
  isAppleLivePhotoStill(attachment) || isAppleLivePhotoVideo(attachment) || isAndroidMotionContainer(attachment);
