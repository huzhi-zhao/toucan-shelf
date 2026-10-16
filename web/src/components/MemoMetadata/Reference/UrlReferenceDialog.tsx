import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslate } from "@/utils/i18n";
import { MAX_URL_REFERENCE_NOTE_LENGTH, normalizeHttpUrl, type UrlReference } from "@/utils/urlReferences";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link being edited; omitted when adding one. */
  initial?: UrlReference;
  onConfirm: (reference: UrlReference) => void;
}

/**
 * Adds or edits one URL reference: the link, and a one-line note on WHEN it should
 * be opened. The note is written for whoever reads the document next — above all
 * an agent, which decides from it whether the task at hand falls inside this
 * link's scope and therefore has to be read.
 */
export const UrlReferenceDialog = ({ open, onOpenChange, initial, onConfirm }: Props) => {
  const t = useTranslate();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initial?.url ?? "");
    setNote(initial?.note ?? "");
    setTouched(false);
  }, [open, initial]);

  const normalized = normalizeHttpUrl(url);
  const showUrlError = touched && url.trim() !== "" && !normalized;

  const confirm = () => {
    setTouched(true);
    if (!normalized) return;
    onConfirm({ url: normalized, note: note.replace(/\s+/g, " ").trim() });
    onOpenChange(false);
  };

  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(initial ? "subdoc.edit-link" : "subdoc.add-link")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="url-reference-url">{t("subdoc.link-url")}</Label>
            <Input
              id="url-reference-url"
              autoFocus
              value={url}
              placeholder="https://"
              aria-invalid={showUrlError}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={submitOnEnter}
            />
            {showUrlError && <p className="text-xs text-destructive">{t("subdoc.invalid-url")}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="url-reference-note">{t("subdoc.link-note")}</Label>
            <Input
              id="url-reference-note"
              value={note}
              maxLength={MAX_URL_REFERENCE_NOTE_LENGTH}
              placeholder={t("subdoc.link-note-placeholder")}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={submitOnEnter}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!normalized} onClick={confirm}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UrlReferenceDialog;
