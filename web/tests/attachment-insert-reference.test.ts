import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { buildAttachmentReferenceMarkdown } from "@/components/MemoEditor/services/mediaInsertService";
import { AttachmentOrigin, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { partitionInlinedAttachments } from "@/utils/attachment";

const attachment = (uid: string, filename: string, type: string, origin: AttachmentOrigin) =>
  create(AttachmentSchema, { name: `attachments/${uid}`, filename, type, origin });

describe("buildAttachmentReferenceMarkdown", () => {
  it("renders media inline and links anything else", () => {
    expect(buildAttachmentReferenceMarkdown(attachment("a1", "视力检查.png", "image/png", AttachmentOrigin.MOUNTED))).toBe(
      "![视力检查.png](/file/attachments/a1/%E8%A7%86%E5%8A%9B%E6%A3%80%E6%9F%A5.png)",
    );
    expect(buildAttachmentReferenceMarkdown(attachment("b2", "report.pdf", "application/pdf", AttachmentOrigin.MOUNTED))).toBe(
      "[report.pdf](/file/attachments/b2/report.pdf)",
    );
  });
});

describe("partitionInlinedAttachments", () => {
  const image = attachment("a1", "chart.svg", "image/svg+xml", AttachmentOrigin.MOUNTED);
  const pdf = attachment("b2", "report.pdf", "application/pdf", AttachmentOrigin.MOUNTED);

  it("keeps mounted attachments the body doesn't reference in the list", () => {
    const { inlined, rest } = partitionInlinedAttachments([image, pdf], "just text");
    expect(inlined).toEqual([]);
    expect(rest).toEqual([image, pdf]);
  });

  it("moves a mounted image out of the list once it is inserted into the body", () => {
    const content = `intro\n\n${buildAttachmentReferenceMarkdown(image)}\n\n${buildAttachmentReferenceMarkdown(pdf)}`;
    const { inlined, rest } = partitionInlinedAttachments([image, pdf], content);
    expect(inlined).toEqual([image]);
    expect(rest).toEqual([pdf]);
  });
});
