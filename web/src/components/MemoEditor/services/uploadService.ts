import { create } from "@bufbuild/protobuf";
import { attachmentServiceClient } from "@/connect";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { AttachmentOrigin, AttachmentSchema, MotionMediaSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { compactDrawioSvgBytes } from "@/utils/drawio";
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
      // draw.io exports carry a base64 PNG of every text label for renderers without
      // `<foreignObject>` support — ~90% of the file, and never used by a browser. Dropped
      // before the bytes reach the server; the embedded diagram source stays, so the stored
      // file is still editable.
      const buffer = compactDrawioSvgBytes(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
      const attachment = await attachmentServiceClient.createAttachment({
        attachment: create(AttachmentSchema, {
          filename: file.name,
          size: BigInt(buffer.byteLength),
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
