import { useMemo } from "react";
import { useInfiniteMemoComments } from "@/hooks/useMemoQueries";
import { splitChildMemos } from "@/utils/subDoc";
import ReferenceActions from "./ReferenceActions";
import ReferenceListView from "./ReferenceListView";

interface Props {
  /** The document being edited. Sub-documents hang off it, so it must already exist. */
  memoName: string;
  className?: string;
}

/**
 * The References section while the document is open in its editor: the same list
 * as the read-only view, plus the controls that create sub-documents.
 *
 * Creating lives here rather than in the preview for the same reason the
 * attachment list works this way — adding to a document is editing it. It also
 * keeps the preview free of an empty section a reader has no use for: with
 * nothing to list, the section renders nothing at all.
 *
 * A sub-document needs a parent to hang off, so this is only rendered for a
 * document that has been saved; the editor does not offer it while composing a
 * brand-new one.
 */
export const ReferenceListEditor = ({ memoName, className }: Props) => {
  // Sub-documents arrive in the same list as comments (one relation underneath).
  const { data: children = [], refetch } = useInfiniteMemoComments(memoName);
  const subDocs = useMemo(() => splitChildMemos(children).subDocs, [children]);

  return (
    <ReferenceListView
      className={className}
      subDocs={subDocs}
      parentMemoName={memoName}
      actions={<ReferenceActions parentMemoName={memoName} onCreated={() => refetch()} />}
    />
  );
};

export default ReferenceListEditor;
