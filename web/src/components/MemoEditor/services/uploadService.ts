import { create } from "@bufbuild/protobuf";
import { attachmentServiceClient } from "@/connect";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { AttachmentOrigin, AttachmentSchema, MotionMediaSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

export const uploadService = {
  /**
   * `workspace` ("workspaces/{uid}") decides which workspace directory the blobs land in
   * on S3. It has to be passed explicitly: uploads happen before the memo exists, so the
   * server has nothing to infer the workspace from.
   */
  async uploadFiles(localFiles: LocalFile[], workspace?: string): Promise<Attachment[]> {
    if (localFiles.length === 0) return [];

    const attachments: Attachment[] = [];

    for (const localFile of localFiles) {
      const { file, motionMedia, attachmentOrigin } = localFile;
      const buffer = new Uint8Array(await file.arrayBuffer());
      const attachment = await attachmentServiceClient.createAttachment({
        attachment: create(AttachmentSchema, {
          filename: file.name,
          size: BigInt(file.size),
          type: file.type,
          content: buffer,
          motionMedia: motionMedia ? create(MotionMediaSchema, motionMedia) : undefined,
          origin: attachmentOrigin ?? AttachmentOrigin.MOUNTED,
        }),
        workspace,
      });
      attachments.push(attachment);
    }

    return attachments;
  },
};
