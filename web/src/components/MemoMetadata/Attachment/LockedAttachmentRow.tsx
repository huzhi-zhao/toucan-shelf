// A locked attachment's row in the attachment panel. This is the one place a
// locked attachment is ever readable — nowhere else renders its bytes at all
// (see the design doc's P5 section: no inline preview for a locked attachment,
// not even for its owner).
//
// Unlocking here is two steps folded into one submit: the master passphrase
// (useSecretMasterKey) if the session doesn't already have it, then the vault
// proof derived from it (useAttachmentVault). Decision 4 in the design doc
// ("首次启用就地引导") is why both happen inline instead of sending the user to
// Settings first — most people who hit this already have a master passphrase
// configured, they just haven't unlocked it in this tab yet.

import { DownloadIcon, ExternalLinkIcon, FileIcon, LoaderCircleIcon, LockIcon, LockOpenIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { extractAttachmentUidFromName } from "@/helpers/resource-names";
import { useAttachmentVault, VaultLockedError } from "@/hooks/useAttachmentVault";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { SecretPassphraseError } from "@/utils/secret-crypto";
import { getAttachmentMetadata, isPreviewableAttachment } from "./attachmentHelpers";

const LockedAttachmentRow = ({ attachment }: { attachment: Attachment }) => {
  const t = useTranslate();
  const masterKeyState = useSecretMasterKey();
  const vault = useAttachmentVault();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { fileTypeLabel, fileSizeLabel } = getAttachmentMetadata(attachment);

  if (vault.unlocked) {
    const previewable = isPreviewableAttachment(attachment);
    const ActionIcon = previewable ? ExternalLinkIcon : DownloadIcon;
    const href = previewable ? `/attachments/${extractAttachmentUidFromName(attachment.name)}/preview` : getAttachmentUrl(attachment);

    return (
      <a
        className="group flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/65 px-3 py-2.5 transition-colors hover:bg-accent/20"
        href={href}
        target={previewable ? "_blank" : undefined}
        rel={previewable ? "noopener noreferrer" : undefined}
        download={previewable ? undefined : attachment.filename}
        title={attachment.filename}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
            <FileIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-tight text-foreground">{attachment.filename}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span>{fileTypeLabel}</span>
              {fileSizeLabel && (
                <>
                  <span className="text-muted-foreground/40">•</span>
                  <span>{fileSizeLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <ActionIcon className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground/70" />
      </a>
    );
  }

  const needsPassphrase = !masterKeyState.unlocked;

  const handleUnlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (needsPassphrase) {
        await masterKeyState.unlock(passphrase);
      }
      await vault.unlock();
      setPassphrase("");
    } catch (err) {
      if (err instanceof SecretPassphraseError) {
        setError(t("secret-block.error.wrong-passphrase"));
      } else if (err instanceof VaultLockedError) {
        setError(t("secret-block.error.wrong-passphrase"));
      } else {
        setError(t("attachment.vault.unlock-error"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5" onSubmit={handleUnlock}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
        <LockIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-foreground" title={attachment.filename}>
          {attachment.filename}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{fileTypeLabel}</div>
      </div>
      {needsPassphrase && (
        <MaskedInput
          revealable
          autoComplete="off"
          className="h-8 w-full max-w-56 text-sm"
          placeholder={t("secret-block.master-passphrase-placeholder")}
          aria-label={t("secret-block.master-passphrase-placeholder")}
          value={passphrase}
          onChange={(event) => {
            setPassphrase(event.target.value);
            if (error) setError("");
          }}
          disabled={busy}
        />
      )}
      <Button type="submit" size="sm" disabled={busy || (needsPassphrase && passphrase === "")}>
        {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <LockOpenIcon className="h-4 w-4" />}
        {t("attachment.vault.unlock")}
      </Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </form>
  );
};

export default LockedAttachmentRow;
