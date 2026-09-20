import { FilePlusIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import PromptDialog from "@/components/Notebook/PromptDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubDocuments } from "@/hooks/useSubDocuments";
import { useTranslate } from "@/utils/i18n";

interface Props {
  parentMemoName: string;
  /** Called with the new sub-document's resource name once it exists. */
  onCreated?: (memoName: string) => void;
}

/** Markdown only. Anything else dropped here belongs in the attachment list, as bytes. */
const ACCEPTED = ".md,.markdown,text/markdown";

/**
 * The two ways a sub-document comes into being, in the section's header.
 *
 * Uploading a `.md` here converts it into a sub-document rather than storing the
 * bytes, which is the one place in the app where that happens: everywhere else a
 * `.md` is an ordinary attachment. The rule is "whichever section you put it in
 * is what it becomes" — deciding by file type instead would turn a markdown file
 * dragged into the body into a sub-document too, which nobody means.
 */
export const ReferenceActions = ({ parentMemoName, onCreated }: Props) => {
  const t = useTranslate();
  const { createSubDoc, createSubDocFromFile } = useSubDocuments(parentMemoName);
  const [promptOpen, setPromptOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A duplicate title is the one failure a user can act on: sub-document titles
  // are unique per parent, so say that rather than showing a raw RPC error.
  const run = async (action: () => Promise<{ name: string }>) => {
    try {
      const created = await action();
      onCreated?.(created.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(/already exists|AlreadyExists/i.test(message) ? t("subdoc.duplicate-title") : message);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPromptOpen(true)}>
            <FilePlusIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("subdoc.new-sub-document")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("subdoc.upload-markdown")}</TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          // Clear first: picking the same file twice in a row fires no change
          // event otherwise, and a failed upload is exactly when someone retries.
          event.target.value = "";
          if (file) await run(() => createSubDocFromFile(file));
        }}
      />
      <PromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        title={t("subdoc.new-sub-document")}
        placeholder={t("subdoc.title-placeholder")}
        onConfirm={async (title) => {
          await run(() => createSubDoc(title));
        }}
      />
    </div>
  );
};

export default ReferenceActions;
