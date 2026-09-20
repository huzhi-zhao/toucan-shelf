import { createContext, type ReactNode, useContext } from "react";

export interface SubDocReference {
  /** Resource name, "memos/{uid}". */
  name: string;
  title: string;
}

interface SubDocReferenceContextValue {
  /** The document being rendered; references only resolve against its own sub-documents. */
  parentMemoName: string;
  subDocs: SubDocReference[];
  /**
   * Scrolls the References section to this sub-document's entry. When absent, a
   * reference still renders and still opens the sub-document — it just cannot
   * jump, which is the right degradation on a surface with no References section
   * on screen.
   */
  onJump?: (memoName: string) => void;
}

const SubDocReferenceContext = createContext<SubDocReferenceContextValue | undefined>(undefined);

/**
 * Lets a rendered document recognize links to its own sub-documents.
 *
 * Necessary because sub-documents are deliberately absent from the workspace
 * tree, which is what every other document link resolves against — without this
 * the normal resolver would mark a perfectly good reference broken. It also
 * carries the jump: a reference to a sub-document scrolls to its entry in the
 * References section rather than navigating away, because a sub-document is part
 * of the document being read and following one should not cost the reader their
 * place.
 */
export const SubDocReferenceProvider = ({ value, children }: { value: SubDocReferenceContextValue; children: ReactNode }) => (
  <SubDocReferenceContext.Provider value={value}>{children}</SubDocReferenceContext.Provider>
);

export const useSubDocReferences = () => useContext(SubDocReferenceContext);
