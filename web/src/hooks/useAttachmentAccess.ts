// Writes Attachment.access — the three-state field behind "设为私密" (locked) and
// "设为公开直链" (public). The gates it flips are entirely server-side
// (attachmentacl.CheckReadAccess); this hook only calls UpdateAttachment and
// refreshes whatever memo/attachment queries might be holding a stale copy.

import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { attachmentServiceClient } from "@/connect";
import { attachmentKeys } from "@/hooks/useAttachmentQueries";
import { memoKeys } from "@/hooks/useMemoQueries";
import { type AttachmentAccess, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

export function useSetAttachmentAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, access }: { name: string; access: AttachmentAccess }) => {
      return attachmentServiceClient.updateAttachment({
        attachment: create(AttachmentSchema, { name, access }),
        updateMask: create(FieldMaskSchema, { paths: ["access"] }),
      });
    },
    onSuccess: () => {
      // Attachments are embedded in the memo they hang on rather than queried
      // independently, so the broad invalidation is what actually reaches every
      // view showing this attachment (detail page, list card previews, etc.).
      queryClient.invalidateQueries({ queryKey: memoKeys.all });
      // The settings list of publicly linkable attachments queries ListAttachments
      // directly rather than through a memo, so it needs its own invalidation —
      // otherwise revoking a link there leaves the revoked row on screen.
      queryClient.invalidateQueries({ queryKey: attachmentKeys.lists() });
    },
  });
}
