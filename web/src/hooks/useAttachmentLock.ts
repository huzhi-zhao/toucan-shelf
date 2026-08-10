// Toggles Attachment.locked. The read-side gate this flips is entirely
// server-side (attachmentacl.CheckReadAccess); this hook only calls
// UpdateAttachment and refreshes whatever memo/attachment queries might be
// holding a stale copy of the flag.

import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { attachmentServiceClient } from "@/connect";
import { memoKeys } from "@/hooks/useMemoQueries";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

export function useSetAttachmentLocked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, locked }: { name: string; locked: boolean }) => {
      return attachmentServiceClient.updateAttachment({
        attachment: create(AttachmentSchema, { name, locked }),
        updateMask: create(FieldMaskSchema, { paths: ["locked"] }),
      });
    },
    onSuccess: () => {
      // Attachments are embedded in the memo they hang on rather than queried
      // independently, so the broad invalidation is what actually reaches every
      // view showing this attachment (detail page, list card previews, etc.).
      queryClient.invalidateQueries({ queryKey: memoKeys.all });
    },
  });
}
