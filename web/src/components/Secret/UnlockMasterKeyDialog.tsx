// The standalone entry point for "unlock the master passphrase" — for the
// accounts that would otherwise have no way to trigger a session unlock, since
// the only other entry point (SecretBlock) requires an encrypted block to
// already exist in the document being viewed.

import { LockIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import MasterPassphraseForm from "./MasterPassphraseForm";

const SETTINGS_LINK = `${ROUTES.SETTING}#preference`;

interface UnlockMasterKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the master key is unlocked. The dialog closes once this resolves. */
  onUnlocked?: () => void | Promise<void>;
}

const UnlockMasterKeyDialog = ({ open, onOpenChange, onUnlocked }: UnlockMasterKeyDialogProps) => {
  const t = useTranslate();
  const masterKeyState = useSecretMasterKey();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {t("secret-block.unlock-dialog-title")}
          </DialogTitle>
          <DialogDescription>{t("secret-block.unlock-dialog-description")}</DialogDescription>
        </DialogHeader>
        {masterKeyState.configured ? (
          <MasterPassphraseForm
            autoFocus
            submitLabel={t("secret-block.unlock")}
            onUnlocked={async () => {
              await onUnlocked?.();
              onOpenChange(false);
            }}
          />
        ) : (
          !masterKeyState.loading && (
            <div className="text-sm text-muted-foreground">
              {t("secret-block.no-master-key")}{" "}
              <Link className="text-primary underline" to={SETTINGS_LINK} onClick={() => onOpenChange(false)}>
                {t("secret-block.set-up-master")}
              </Link>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UnlockMasterKeyDialog;
