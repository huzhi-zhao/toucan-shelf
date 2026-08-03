import { KeyRoundIcon, LoaderCircleIcon, LockIcon, LockOpenIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import { useTranslate } from "@/utils/i18n";
import { SecretIntegrityError, SecretPassphraseError } from "@/utils/secret-crypto";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";

// Below this, the passphrase is the weakest link in the whole scheme: the master
// key it guards is 256 random bits, so a short passphrase is the only thing worth
// attacking. Enforced rather than merely suggested, because the cost of a weak one
// is not recoverable after the fact.
const MIN_PASSPHRASE_LENGTH = 12;

type Strength = "weak" | "fair" | "strong";

/**
 * A rough passphrase strength estimate.
 *
 * Deliberately crude — length dominates, character variety contributes a little.
 * It is a nudge toward longer passphrases, not a security control, and it is not
 * what stops a weak one: MIN_PASSPHRASE_LENGTH does that.
 */
const estimateStrength = (passphrase: string): Strength => {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(passphrase)).length;
  if (passphrase.length >= 20 || (passphrase.length >= 16 && classes >= 3)) return "strong";
  if (passphrase.length >= 14 || (passphrase.length >= MIN_PASSPHRASE_LENGTH && classes >= 3)) return "fair";
  return "weak";
};

type Panel = "none" | "unlock" | "setup" | "change" | "reset";

const SecretKeySection = () => {
  const t = useTranslate();
  const master = useSecretMasterKey();

  const [panel, setPanel] = useState<Panel>("none");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const closePanel = () => {
    setPanel("none");
    setCurrent("");
    setNext("");
    setConfirmation("");
    setResetAcknowledged(false);
    setError("");
  };

  const openPanel = (target: Panel) => {
    closePanel();
    setPanel(target);
  };

  const describeError = (err: unknown): string => {
    if (err instanceof SecretPassphraseError) return t("setting.secret-key.error.wrong-passphrase");
    if (err instanceof SecretIntegrityError) return t("setting.secret-key.error.corrupted");
    return err instanceof Error ? err.message : String(err);
  };

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      toast.success(successMessage);
      closePanel();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (panel) {
      case "unlock":
        return run(() => master.unlock(current), t("setting.secret-key.unlocked"));
      case "setup":
        return run(() => master.setup(next), t("setting.secret-key.configured"));
      case "change":
        return run(() => master.changePassphrase(current, next), t("setting.secret-key.changed"));
      case "reset":
        return run(() => master.reset(next), t("setting.secret-key.reset-done"));
      default:
        return undefined;
    }
  };

  const newPassphraseValid = next.length >= MIN_PASSPHRASE_LENGTH && next === confirmation;
  const canSubmit =
    panel === "unlock"
      ? current !== ""
      : panel === "change"
        ? current !== "" && newPassphraseValid
        : panel === "reset"
          ? resetAcknowledged && newPassphraseValid
          : newPassphraseValid;

  const strength = next === "" ? null : estimateStrength(next);

  const statusDescription = !master.configured
    ? t("setting.secret-key.status-unconfigured")
    : master.unlocked
      ? t("setting.secret-key.status-unlocked")
      : t("setting.secret-key.status-locked");

  return (
    <SettingGroup title={t("setting.secret-key.title")} description={t("setting.secret-key.description")} showSeparator>
      <SettingList>
        <SettingListItem
          label={t("setting.secret-key.status")}
          description={statusDescription}
          icon={master.unlocked ? <LockOpenIcon className="w-4 h-4" /> : <LockIcon className="w-4 h-4" />}
        >
          <div className="flex flex-wrap items-center gap-2">
            {!master.configured && (
              <Button variant="default" size="sm" disabled={master.loading} onClick={() => openPanel("setup")}>
                <KeyRoundIcon className="w-4 h-4" />
                {t("setting.secret-key.set-up")}
              </Button>
            )}
            {master.configured && !master.unlocked && (
              <Button variant="default" size="sm" onClick={() => openPanel("unlock")}>
                <LockOpenIcon className="w-4 h-4" />
                {t("setting.secret-key.unlock")}
              </Button>
            )}
            {master.configured && master.unlocked && (
              <Button variant="outline" size="sm" onClick={master.lock}>
                <LockIcon className="w-4 h-4" />
                {t("setting.secret-key.lock-now")}
              </Button>
            )}
            {master.configured && (
              <>
                <Button variant="outline" size="sm" onClick={() => openPanel("change")}>
                  {t("setting.secret-key.change")}
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => openPanel("reset")}>
                  {t("setting.secret-key.reset")}
                </Button>
              </>
            )}
          </div>
        </SettingListItem>

        {panel !== "none" && (
          <SettingListItem vertical label={t(`setting.secret-key.panel.${panel}` as const)}>
            <form className="flex w-full flex-col gap-2" onSubmit={submit}>
              {/* Resetting throws away the key every existing block was encrypted
                  against. There is no server-side copy and no recovery, so this
                  says so plainly and asks for an explicit acknowledgement rather
                  than relying on the button's wording. */}
              {panel === "reset" && (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={resetAcknowledged}
                    onChange={(event) => setResetAcknowledged(event.target.checked)}
                  />
                  <span className="flex items-start gap-1.5">
                    <ShieldAlertIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
                    {t("setting.secret-key.reset-warning")}
                  </span>
                </label>
              )}

              {(panel === "unlock" || panel === "change") && (
                <MaskedInput
                  revealable
                  autoFocus
                  className="w-full max-w-72"
                  placeholder={t("setting.secret-key.current-passphrase")}
                  aria-label={t("setting.secret-key.current-passphrase")}
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  disabled={busy}
                />
              )}

              {panel !== "unlock" && (
                <>
                  <MaskedInput
                    revealable
                    autoFocus={panel === "setup"}
                    className="w-full max-w-72"
                    placeholder={t("setting.secret-key.new-passphrase")}
                    aria-label={t("setting.secret-key.new-passphrase")}
                    value={next}
                    onChange={(event) => setNext(event.target.value)}
                    disabled={busy}
                  />
                  <MaskedInput
                    revealable
                    className="w-full max-w-72"
                    placeholder={t("setting.secret-key.confirm-passphrase")}
                    aria-label={t("setting.secret-key.confirm-passphrase")}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={busy}
                  />
                  {strength && (
                    <span
                      className={
                        strength === "strong"
                          ? "text-xs text-green-600"
                          : strength === "fair"
                            ? "text-xs text-amber-600"
                            : "text-xs text-destructive"
                      }
                    >
                      {t(`setting.secret-key.strength-${strength}` as const)}
                      {next.length < MIN_PASSPHRASE_LENGTH && ` · ${t("setting.secret-key.min-length", { count: MIN_PASSPHRASE_LENGTH })}`}
                    </span>
                  )}
                  {confirmation !== "" && next !== confirmation && (
                    <span className="text-xs text-destructive">{t("setting.secret-key.mismatch")}</span>
                  )}
                </>
              )}

              {error && (
                <span className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                  <TriangleAlertIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
                  {error}
                </span>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={busy || !canSubmit}>
                  {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
                  {t("common.confirm")}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={closePanel}>
                  {t("common.cancel")}
                </Button>
              </div>

              {panel !== "unlock" && <span className="text-xs text-muted-foreground">{t("setting.secret-key.no-recovery")}</span>}
            </form>
          </SettingListItem>
        )}
      </SettingList>
    </SettingGroup>
  );
};

export default SecretKeySection;
