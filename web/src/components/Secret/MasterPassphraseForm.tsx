// The one piece of UI for "type the master passphrase, unlock the session" —
// shared by SecretBlock's master-mode unlock, LockedAttachmentRow, and
// UnlockMasterKeyDialog so this logic exists in exactly one place.

import { LoaderCircleIcon, LockOpenIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { SecretPassphraseError } from "@/utils/secret-crypto";

interface MasterPassphraseFormProps {
  /** Called after the master key unlock succeeds. May throw — its error is mapped with `mapError`. */
  onUnlocked?: () => void | Promise<void>;
  submitLabel: string;
  /** Renders the submit button as an icon only (submitLabel becomes its title/aria-label instead). For tight rows like LockedAttachmentRow. */
  iconOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Maps a thrown error to a display string. Defaults to the wrong-passphrase / generic split. */
  mapError?: (err: unknown, t: ReturnType<typeof useTranslate>) => string;
}

const defaultMapError = (err: unknown, t: ReturnType<typeof useTranslate>) =>
  err instanceof SecretPassphraseError ? t("secret-block.error.wrong-passphrase") : t("secret-block.error.unlock-failed");

const MasterPassphraseForm = ({
  onUnlocked,
  submitLabel,
  iconOnly,
  autoFocus,
  className,
  mapError = defaultMapError,
}: MasterPassphraseFormProps) => {
  const t = useTranslate();
  const masterKeyState = useSecretMasterKey();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await masterKeyState.unlock(passphrase);
      setPassphrase("");
      await onUnlocked?.();
    } catch (err) {
      setError(mapError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={cn("flex flex-1 flex-wrap items-center gap-2", className)} onSubmit={handleSubmit}>
      <MaskedInput
        revealable
        autoFocus={autoFocus}
        autoComplete="off"
        className="h-8 min-w-0 flex-1 basis-32 text-sm"
        placeholder={t("secret-block.master-passphrase-placeholder")}
        aria-label={t("secret-block.master-passphrase-placeholder")}
        value={passphrase}
        onChange={(event) => {
          setPassphrase(event.target.value);
          if (error) setError("");
        }}
        disabled={busy}
      />
      <Button
        type="submit"
        size={iconOnly ? "icon" : "sm"}
        title={iconOnly ? submitLabel : undefined}
        aria-label={iconOnly ? submitLabel : undefined}
        disabled={busy || passphrase === ""}
      >
        {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <LockOpenIcon className="h-4 w-4" />}
        {!iconOnly && submitLabel}
      </Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </form>
  );
};

export default MasterPassphraseForm;
