import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { workspaceKeys } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { type Memo, Memo_DocType } from "@/types/proto/api/v1/memo_service_pb";
import { DOC_ICON_PRESETS, normalizeDocIcon } from "@/utils/docIcon";
import { useTranslate } from "@/utils/i18n";
import DocTypeIcon from "./DocTypeIcon";

interface Props {
  memo: Pick<Memo, "name" | "icon" | "docType">;
}

/**
 * The document's icon at the head of the document view; clicking it picks a system emoji to use
 * in place of the doc-type default. Writing it touches the memo payload only: no content
 * revision, no `updatedTs` bump, no memogit diff.
 */
const DocIconPicker = ({ memo }: Props) => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { mutateAsync: updateMemoAsync } = useUpdateMemo();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft("");
      setInvalid(false);
    }
  };

  const apply = async (icon: string) => {
    setOpen(false);
    if (icon === memo.icon) return;
    try {
      await updateMemoAsync({ update: { name: memo.name, icon }, updateMask: ["icon"] });
      // The tree is its own query (every knowledge base's tree carries its documents' icons).
      queryClient.invalidateQueries({ queryKey: workspaceKeys.trees() });
    } catch {
      toast.error(t("message.update-failed"));
    }
  };

  // The OS emoji keyboard inserts a whole emoji at once, so a valid draft applies immediately;
  // anything else waits for Enter, which then explains what is wrong.
  const handleDraftChange = (value: string) => {
    setDraft(value);
    setInvalid(false);
    const icon = normalizeDocIcon(value);
    if (icon) void apply(icon);
  };

  const handleDraftSubmit = () => {
    const icon = normalizeDocIcon(draft);
    if (icon) void apply(icon);
    else setInvalid(true);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title={t("notebook.doc-icon")}
          aria-label={t("notebook.doc-icon")}
        >
          <DocTypeIcon docType={Memo_DocType[memo.docType]} icon={memo.icon} size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[19rem] p-2">
        <div className="grid grid-cols-10 gap-0.5 max-h-56 overflow-y-auto">
          {DOC_ICON_PRESETS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded text-lg leading-none hover:bg-accent",
                emoji === memo.icon && "bg-accent",
              )}
              onClick={() => void apply(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-border pt-2 flex flex-col gap-1">
          <Input
            value={draft}
            placeholder={t("notebook.doc-icon-custom-placeholder")}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleDraftSubmit();
              }
            }}
          />
          <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
            {invalid ? t("notebook.doc-icon-invalid") : t("notebook.doc-icon-custom-hint")}
          </p>
          {memo.icon && (
            <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => void apply("")}>
              {t("notebook.doc-icon-reset")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DocIconPicker;
