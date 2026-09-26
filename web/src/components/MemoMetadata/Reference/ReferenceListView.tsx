import { FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";
import MetadataSection from "@/components/MemoMetadata/MetadataSection";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import SubDocCard from "./SubDocCard";

interface Props {
  subDocs: Memo[];
  /** The document these hang off; enables "copy reference" on each entry. */
  parentMemoName?: string;
  /** The sub-document a body reference just pointed at, emphasized on arrival. */
  highlightedMemoName?: string;
  /** Header controls for creating sub-documents; omitted for a reader who cannot write. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The References section: a document's sub-documents, listed above its
 * attachments.
 *
 * It reads as a sibling of the attachment list on purpose. Attachments turned
 * out to be the part of a document's metadata people actually use, so the place
 * to put "content that belongs to this document but not in its body" is right
 * next to them, in the same shape — not behind a panel that has to be opened.
 */
export const ReferenceListView = ({ subDocs, parentMemoName, highlightedMemoName, actions, className }: Props) => {
  const t = useTranslate();

  // Whether an empty document shows this section at all is decided by whether
  // there is anything to DO here, which is exactly `actions`:
  //
  //   preview (no actions) — nothing to list, nothing to add, so nothing is
  //     drawn, and the outline's entry is gated on the same emptiness. A reader
  //     has no use for a section that is only a header.
  //   editor (actions)     — always drawn, empty or not. It is the only place a
  //     sub-document can be created, so hiding it when there are none makes the
  //     first one impossible to add.
  if (subDocs.length === 0 && !actions) return null;

  return (
    <MetadataSection
      className={className}
      icon={FileTextIcon}
      title={t("subdoc.references")}
      count={subDocs.length}
      actions={actions}
      contentClassName="flex flex-col gap-1.5 p-1.5"
    >
      {subDocs.map((subDoc) => (
        <SubDocCard key={subDoc.name} memo={subDoc} parentMemoName={parentMemoName} highlighted={subDoc.name === highlightedMemoName} />
      ))}
    </MetadataSection>
  );
};

export default ReferenceListView;
