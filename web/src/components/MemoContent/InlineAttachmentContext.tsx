import { createContext, useContext, useMemo } from "react";
import { isPublicAttachment } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentNameFromUrl } from "@/utils/attachment";

// Media inserted into the body renders as markdown `![]()` and is partitioned out of the
// attachment list entirely (partitionInlinedAttachments), so the renderer sees a bare URL
// with no attachment record behind it. This context hands the memo's attachments down so an
// inline image can recover its own record — currently only to tell whether it is publicly
// linkable, which is otherwise invisible outside the editor.
//
// Keyed by `attachments/{uid}` rather than by URL: the markdown may carry a stale filename
// segment from before a rename, and the uid is the part that actually identifies the file.
const InlineAttachmentContext = createContext<Map<string, Attachment>>(new Map());

export const InlineAttachmentProvider = ({ attachments, children }: { attachments: Attachment[]; children: React.ReactNode }) => {
  const value = useMemo(() => new Map(attachments.map((attachment) => [attachment.name, attachment])), [attachments]);

  return <InlineAttachmentContext.Provider value={value}>{children}</InlineAttachmentContext.Provider>;
};

// Returns the attachment behind an inline media URL only when it is publicly linkable.
// Undefined covers every uninteresting case alike: an external link, a memo rendered
// without a provider (embeds, previews), or an ordinary private attachment.
export const usePublicInlineAttachment = (src: string | undefined): Attachment | undefined => {
  const attachments = useContext(InlineAttachmentContext);
  const name = getAttachmentNameFromUrl(src);
  if (!name) return undefined;
  const attachment = attachments.get(name);
  return attachment && isPublicAttachment(attachment) ? attachment : undefined;
};
