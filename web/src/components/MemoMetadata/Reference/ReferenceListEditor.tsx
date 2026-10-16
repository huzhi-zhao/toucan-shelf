import { useMemo, useState } from "react";
import { useInfiniteMemoComments } from "@/hooks/useMemoQueries";
import { splitChildMemos } from "@/utils/subDoc";
import { parseUrlReferences, setUrlReferences, type UrlReference } from "@/utils/urlReferences";
import ReferenceActions from "./ReferenceActions";
import ReferenceListView from "./ReferenceListView";
import UrlReferenceDialog from "./UrlReferenceDialog";

interface Props {
  /** The document being edited. Sub-documents hang off it, so it must already exist. */
  memoName: string;
  /** The editor's draft. External links live in its frontmatter. */
  content: string;
  /** Writes a new draft back into the editor (adding, editing or removing a link). */
  onContentChange: (content: string) => void;
  className?: string;
}

/**
 * The References section while the document is open in its editor: the same list
 * as the read-only view, plus the controls that create sub-documents and manage
 * external links.
 *
 * Creating lives here rather than in the preview for the same reason the
 * attachment list works this way — adding to a document is editing it. It also
 * keeps the preview free of an empty section a reader has no use for: with
 * nothing to list, the section renders nothing at all.
 *
 * The two kinds are written differently. A sub-document is a memo of its own, so
 * creating one is saved at once. A link is a line in this document's frontmatter,
 * so it goes into the editor's draft — the same text the source editor shows —
 * and is saved with the document.
 *
 * A sub-document needs a parent to hang off, so this is only rendered for a
 * document that has been saved; the editor does not offer it while composing a
 * brand-new one.
 */
export const ReferenceListEditor = ({ memoName, content, onContentChange, className }: Props) => {
  // Sub-documents arrive in the same list as comments (one relation underneath).
  const { data: children = [], refetch } = useInfiniteMemoComments(memoName);
  const subDocs = useMemo(() => splitChildMemos(children).subDocs, [children]);
  const { references, invalidCount } = useMemo(() => parseUrlReferences(content), [content]);
  // undefined: closed. "new": adding. A number: editing that link.
  const [dialog, setDialog] = useState<"new" | number>();

  // With unreadable lines present the list is read-only: writing it back in the
  // canonical form would replace the lines this parser did not understand.
  const editable = invalidCount === 0;
  const write = (next: UrlReference[]) => onContentChange(setUrlReferences(content, next));

  return (
    <>
      <ReferenceListView
        className={className}
        subDocs={subDocs}
        parentMemoName={memoName}
        urlReferences={references}
        unreadableUrlReferences={invalidCount}
        onEditUrlReference={editable ? (index) => setDialog(index) : undefined}
        onRemoveUrlReference={editable ? (index) => write(references.filter((_, i) => i !== index)) : undefined}
        actions={
          <ReferenceActions
            parentMemoName={memoName}
            onCreated={() => refetch()}
            onAddLink={() => setDialog("new")}
            addLinkDisabled={!editable}
          />
        }
      />
      <UrlReferenceDialog
        open={dialog !== undefined}
        onOpenChange={(open) => !open && setDialog(undefined)}
        initial={typeof dialog === "number" ? references[dialog] : undefined}
        onConfirm={(reference) =>
          write(typeof dialog === "number" ? references.map((r, i) => (i === dialog ? reference : r)) : [...references, reference])
        }
      />
    </>
  );
};

export default ReferenceListEditor;
