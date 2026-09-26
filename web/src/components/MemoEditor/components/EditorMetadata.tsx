import { type FC, useState } from "react";
import { AttachmentListEditor, LocationDisplayEditor, ReferenceListEditor, RelationListEditor } from "@/components/MemoMetadata";
import { partitionInlinedAttachments } from "@/utils/attachment";
import { useEditorContext, useEditorSelector } from "../state";
import type { EditorMetadataProps } from "../types";

export const EditorMetadata: FC<EditorMetadataProps> = ({ memoName, showReferences }) => {
  const { actions, dispatch } = useEditorContext();
  const attachments = useEditorSelector((s) => s.metadata.attachments);
  const content = useEditorSelector((s) => s.content);
  const localFiles = useEditorSelector((s) => s.localFiles);
  const relations = useEditorSelector((s) => s.metadata.relations);
  const location = useEditorSelector((s) => s.metadata.location);
  const [showInlineAttachments, setShowInlineAttachments] = useState(false);

  // Attachments already referenced inline in content (pasted/dropped media) render as part of
  // the markdown itself, so they're hidden here by default — only "real" attachments are
  // editable/removable. The eye toggle below reveals them so an inline-referenced attachment
  // that's no longer wanted can still be deleted.
  const { inlined, rest: visibleAttachments } = partitionInlinedAttachments(attachments, content);

  return (
    <div className="w-full flex flex-col gap-2">
      <AttachmentListEditor
        attachments={showInlineAttachments ? attachments : visibleAttachments}
        localFiles={localFiles}
        onAttachmentsChange={(next) => dispatch(actions.setMetadata({ attachments: showInlineAttachments ? next : [...next, ...inlined] }))}
        onLocalFilesChange={(next) => dispatch(actions.setLocalFiles(next))}
        onRemoveLocalFile={(previewUrl) => dispatch(actions.removeLocalFile(previewUrl))}
        hiddenInlineCount={inlined.length}
        showInlineAttachments={showInlineAttachments}
        onToggleShowInlineAttachments={() => setShowInlineAttachments((prev) => !prev)}
        memoName={memoName}
      />

      {showReferences && memoName && <ReferenceListEditor memoName={memoName} />}

      <RelationListEditor
        relations={relations}
        onRelationsChange={(next) => dispatch(actions.setMetadata({ relations: next }))}
        memoName={memoName}
      />

      {location && <LocationDisplayEditor location={location} onRemove={() => dispatch(actions.setMetadata({ location: undefined }))} />}
    </div>
  );
};
