import { FileTextIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import MetadataSection from "@/components/MemoMetadata/MetadataSection";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { UrlReference } from "@/utils/urlReferences";
import SubDocCard from "./SubDocCard";
import UrlReferenceCard from "./UrlReferenceCard";

interface Props {
  subDocs: Memo[];
  /** The document these hang off; enables "copy reference" on each entry. */
  parentMemoName?: string;
  /** The sub-document a body reference just pointed at, emphasized on arrival. */
  highlightedMemoName?: string;
  /** External links from the document's frontmatter, listed after the sub-documents. */
  urlReferences?: UrlReference[];
  /** Lines under `references` that could not be read as links; shown as a warning, never dropped silently. */
  unreadableUrlReferences?: number;
  /** Editor only: per-link controls. Omitted, the links are read-only. */
  onEditUrlReference?: (index: number) => void;
  onRemoveUrlReference?: (index: number) => void;
  /** Header controls for creating sub-documents and adding links; omitted for a reader who cannot write. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The References section: a document's sub-documents and its external links,
 * listed above its attachments.
 *
 * The two kinds have nothing in common as objects — a sub-document is a memo in
 * this system, a link points outside it — and share the section only because
 * they matter equally: both are part of the document, and a reader (an agent
 * above all) has to open them on purpose rather than conclude from the body.
 *
 * It reads as a sibling of the attachment list on purpose. Attachments turned
 * out to be the part of a document's metadata people actually use, so the place
 * to put "content that belongs to this document but not in its body" is right
 * next to them, in the same shape — not behind a panel that has to be opened.
 */
export const ReferenceListView = ({
  subDocs,
  parentMemoName,
  highlightedMemoName,
  urlReferences = [],
  unreadableUrlReferences = 0,
  onEditUrlReference,
  onRemoveUrlReference,
  actions,
  className,
}: Props) => {
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
  const isEmpty = subDocs.length === 0 && urlReferences.length === 0 && unreadableUrlReferences === 0;
  if (isEmpty && !actions) return null;

  return (
    <MetadataSection
      className={className}
      icon={FileTextIcon}
      title={t("subdoc.references")}
      count={subDocs.length + urlReferences.length}
      actions={actions}
      contentClassName="flex flex-col gap-1.5 p-1.5"
    >
      {subDocs.map((subDoc) => (
        <SubDocCard key={subDoc.name} memo={subDoc} parentMemoName={parentMemoName} highlighted={subDoc.name === highlightedMemoName} />
      ))}
      {urlReferences.map((reference, index) => (
        <UrlReferenceCard
          // Links may repeat, so position is part of the identity.
          key={`${index}:${reference.url}`}
          reference={reference}
          onEdit={onEditUrlReference && (() => onEditUrlReference(index))}
          onRemove={onRemoveUrlReference && (() => onRemoveUrlReference(index))}
        />
      ))}
      {unreadableUrlReferences > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("subdoc.unreadable-links", { count: unreadableUrlReferences })}</span>
        </div>
      )}
    </MetadataSection>
  );
};

export default ReferenceListView;
