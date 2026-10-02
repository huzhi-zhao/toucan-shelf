import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import dayjs from "dayjs";
import { HourglassIcon, LoaderCircleIcon, LockIcon, ShieldAlertIcon, ShieldIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/masked-input";
import { Textarea } from "@/components/ui/textarea";
import { secretBlockServiceClient } from "@/connect";
import { fetchSecretBlockSummary, useSetSecretBlockSummary } from "@/hooks/useSecretBlockSummary";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import { cn } from "@/lib/utils";
import {
  type SecretBlockPolicy,
  SecretBlockPolicy_Preset,
  SecretBlockRestriction_UnlockState,
  type SecretBlockSummary,
} from "@/types/proto/api/v1/secret_block_service_pb";
import type { Translations } from "@/utils/i18n";
import { useTranslate } from "@/utils/i18n";
import { decryptWithMasterKey, encryptWithMasterKey, isMasterEnvelope, type SecretEnvelope } from "@/utils/secret-crypto";
import {
  browserTimeZone,
  emergencyReasonLongEnough,
  emergencyStatementFor,
  MIN_EMERGENCY_REASON_LENGTH,
  typedTextMatches,
} from "@/utils/secret-restriction";
import { getSecretMasterKey } from "@/utils/secret-session";
import { blockCopyProps, blockPasteProps, CanvasText, SegmentedSecret } from "./SecretCanvas";

// The time-gated form of a secret block. Every decision about *when* it opens is
// made by the server; this component only renders the state the server reports
// and collects what the server asks for (typed confirmations, a reason).
// See docs/dev/requirements/editor/restricted-secret-block.md.

interface RestrictedSecretBlockProps {
  summary: SecretBlockSummary;
  title: string;
  className?: string;
}

type Panel = "none" | "request" | "emergency" | "replace";

const toDate = (ts: Timestamp | undefined): Date | undefined => (ts ? timestampDate(ts) : undefined);
const formatTime = (date: Date | undefined) => (date ? dayjs(date).format("MM-DD HH:mm") : "");

// setTimeout overflows past ~24.8 days; nothing here needs to wake later than that.
const MAX_TIMER_MS = 2 ** 31 - 1;

const errorDetail = (error: unknown) => (error instanceof ConnectError ? error.rawMessage : error instanceof Error ? error.message : "");

export const RestrictedSecretBlock = ({ summary, title, className }: RestrictedSecretBlockProps) => {
  const t = useTranslate();
  const { i18n } = useTranslation();
  const masterKeyState = useSecretMasterKey();
  const setSummary = useSetSecretBlockSummary();
  const restriction = summary.restriction;
  const policy = restriction?.policy;
  const state = restriction?.unlockState ?? SecretBlockRestriction_UnlockState.LOCKED;
  const isHigh = policy?.preset === SecretBlockPolicy_Preset.HIGH_IMPACT;

  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<Translations | "">("");
  const [errorText, setErrorText] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");

  const availableAt = toDate(restriction?.availableTime);
  const expireAt = toDate(restriction?.expireTime);

  const refresh = async () => {
    setSummary(await fetchSecretBlockSummary(summary.name));
  };

  // The server's state is time-based. Wake at the next boundary (opening time,
  // end of the viewing window) and ask again, so the card never shows a stale
  // "waiting" or keeps showing a secret past its window.
  const boundary =
    state === SecretBlockRestriction_UnlockState.PENDING
      ? availableAt
      : state === SecretBlockRestriction_UnlockState.READY || state === SecretBlockRestriction_UnlockState.OPEN
        ? expireAt
        : undefined;
  const boundaryMs = boundary?.getTime();
  useEffect(() => {
    if (boundaryMs === undefined) return;
    const timer = setTimeout(
      () => {
        if (state !== SecretBlockRestriction_UnlockState.PENDING) setPlaintext(null);
        void refresh().catch(() => undefined);
      },
      Math.min(Math.max(boundaryMs - Date.now(), 0) + 500, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryMs, state, summary.name]);

  // Locking the session closes an open secret, as for ordinary blocks.
  useEffect(() => {
    if (!masterKeyState.unlocked) setPlaintext(null);
  }, [masterKeyState.unlocked]);

  const fail = (key: Translations, error?: unknown) => {
    setErrorKey(key);
    setErrorText(error ? errorDetail(error) : "");
    setBusy(false);
  };

  const run = async (action: () => Promise<void>, failKey: Translations) => {
    if (busy) return;
    setBusy(true);
    setErrorKey("");
    try {
      await action();
      setBusy(false);
    } catch (error) {
      fail(failKey, error);
    }
  };

  const ensureMasterKey = async () => {
    let key = getSecretMasterKey();
    if (!key) {
      await masterKeyState.unlock(passphrase);
      key = getSecretMasterKey();
    }
    if (!key) throw new Error(t("secret-block.error.locked-session"));
    setPassphrase("");
    return key;
  };

  const view = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      // Unlock the session before fetching: the first fetch starts the window,
      // and it should not be spent waiting on a mistyped passphrase.
      const key = await ensureMasterKey();
      const record = await secretBlockServiceClient.getSecretBlock({ name: summary.name });
      const e = record.envelope;
      if (!e) throw new Error(t("secret-block.error.not-found"));
      const envelope: SecretEnvelope = {
        kdf: e.kdf,
        kdfIterations: e.kdfIterations,
        cipher: e.cipher,
        salt: e.salt,
        nonce: e.nonce,
        verifier: e.verifier,
        ciphertext: e.ciphertext,
      };
      if (!isMasterEnvelope(envelope)) throw new Error(t("secret-block.error.unsupported"));
      setPlaintext(await decryptWithMasterKey(envelope, key));
      if (record.restriction) setSummary({ ...summary, restriction: record.restriction });
    }, "secret-block.restricted.error.view-failed");
  };

  const errorLine = errorKey ? (
    <p className="flex items-start gap-1.5 px-3 pb-2.5 text-xs text-destructive" role="alert">
      <TriangleAlertIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>
        {t(errorKey)}
        {errorText && <span className="opacity-70"> ({errorText})</span>}
      </span>
    </p>
  ) : null;

  const passphraseField = !masterKeyState.unlocked && (
    <MaskedInput
      revealable
      className="h-8 w-full max-w-56 text-sm"
      placeholder={t("secret-block.master-passphrase-placeholder")}
      aria-label={t("secret-block.master-passphrase-placeholder")}
      value={passphrase}
      onChange={(event) => setPassphrase(event.target.value)}
      disabled={busy}
    />
  );

  // ---- Viewing ------------------------------------------------------------

  if (plaintext !== null) {
    return (
      <Shell className={className} title={title} policy={policy} t={t}>
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            {t("secret-block.restricted.viewing-until", { time: formatTime(expireAt) })} · {t("secret-block.restricted.hold-to-reveal")}
          </p>
          {plaintext === "" ? (
            <p className="text-sm text-muted-foreground">{t("secret-block.empty")}</p>
          ) : (
            <SegmentedSecret text={plaintext} segmentLabel={(n) => t("secret-block.restricted.segment", { n })} />
          )}
          <div>
            <Button variant="ghost" size="sm" onClick={() => setPlaintext(null)}>
              <LockIcon className="w-4 h-4" />
              {t("secret-block.restricted.close")}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  // ---- Status line --------------------------------------------------------

  let statusLine: ReactNode;
  let primary: ReactNode = null;
  switch (state) {
    case SecretBlockRestriction_UnlockState.PENDING:
      statusLine = (
        <span className="flex items-center gap-1.5">
          <HourglassIcon className="w-3.5 h-3.5" />
          {t("secret-block.restricted.pending", { time: formatTime(availableAt) })}
        </span>
      );
      primary = (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setSummary(await secretBlockServiceClient.cancelSecretBlockUnlock({ name: summary.name }));
            }, "secret-block.restricted.error.request-failed")
          }
        >
          {t("secret-block.restricted.cancel-request")}
        </Button>
      );
      break;
    case SecretBlockRestriction_UnlockState.READY:
    case SecretBlockRestriction_UnlockState.OPEN:
      statusLine =
        state === SecretBlockRestriction_UnlockState.READY
          ? t("secret-block.restricted.ready", { time: formatTime(expireAt), minutes: Math.round((policy?.viewSeconds ?? 600) / 60) })
          : t("secret-block.restricted.open", { time: formatTime(expireAt) });
      primary = (
        <form className="flex flex-wrap items-center gap-2" onSubmit={view}>
          {passphraseField}
          <Button type="submit" size="sm" disabled={busy || (!masterKeyState.unlocked && passphrase === "")}>
            {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
            {t("secret-block.restricted.view")}
          </Button>
        </form>
      );
      break;
    default:
      statusLine = t("secret-block.restricted.locked");
      primary = (
        <Button size="sm" disabled={busy} onClick={() => setPanel(panel === "request" ? "none" : "request")}>
          {t("secret-block.restricted.request")}
        </Button>
      );
  }

  const canEmergency =
    isHigh &&
    (state === SecretBlockRestriction_UnlockState.LOCKED || state === SecretBlockRestriction_UnlockState.PENDING) &&
    (restriction?.emergencyRemaining ?? 0) > 0;
  const emergencyExhausted = isHigh && (restriction?.emergencyRemaining ?? 0) <= 0 && restriction?.nextEmergencyTime;
  const pendingChange = restriction?.pendingChange;

  return (
    <Shell className={className} title={title} policy={policy} t={t}>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="text-sm text-muted-foreground">{statusLine}</div>
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {canEmergency && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPanel(panel === "emergency" ? "none" : "emergency")}>
              <ShieldAlertIcon className="w-4 h-4" />
              {t("secret-block.restricted.emergency")}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPanel(panel === "replace" ? "none" : "replace")}>
            {t("secret-block.restricted.replace")}
          </Button>
        </div>

        {canEmergency && (
          <p className="text-xs text-muted-foreground">
            {t("secret-block.restricted.emergency-remaining", { count: restriction?.emergencyRemaining ?? 0 })}
          </p>
        )}
        {emergencyExhausted && (
          <p className="text-xs text-muted-foreground">
            {t("secret-block.restricted.emergency-next", { time: formatTime(toDate(restriction?.nextEmergencyTime)) })}
          </p>
        )}
        {restriction?.lastEmergencyTime && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("secret-block.restricted.last-emergency", {
              time: formatTime(toDate(restriction.lastEmergencyTime)),
              reason: restriction.lastEmergencyReason,
            })}
          </p>
        )}
        {pendingChange && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {pendingChange.policy
                ? t("secret-block.restricted.pending-change-update", { time: formatTime(toDate(pendingChange.effectiveTime)) })
                : t("secret-block.restricted.pending-change-lift", { time: formatTime(toDate(pendingChange.effectiveTime)) })}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setSummary(await secretBlockServiceClient.cancelSecretBlockPolicyChange({ name: summary.name }));
                }, "secret-block.restricted.error.update-failed")
              }
            >
              {t("secret-block.restricted.cancel-change")}
            </Button>
          </div>
        )}

        {(panel === "request" || panel === "emergency") && policy && (
          <RequestForm
            policy={policy}
            emergency={panel === "emergency"}
            emergencyStatement={emergencyStatementFor(i18n.language)}
            busy={busy}
            t={t}
            onSubmit={(confirmText, emergency) =>
              void run(async () => {
                setSummary(
                  await secretBlockServiceClient.requestSecretBlockUnlock({
                    name: summary.name,
                    confirmText,
                    emergency: !!emergency,
                    emergencyText: emergency?.statement ?? "",
                    emergencyReason: emergency?.reason ?? "",
                  }),
                );
                setPanel("none");
              }, "secret-block.restricted.error.request-failed")
            }
          />
        )}

        {panel === "replace" && (
          <ReplaceForm
            busy={busy}
            passphraseField={passphraseField}
            needsPassphrase={!masterKeyState.unlocked && passphrase === ""}
            t={t}
            onSubmit={(content) =>
              void run(async () => {
                const key = await ensureMasterKey();
                const updated = await secretBlockServiceClient.updateSecretBlock({
                  secretBlock: { name: summary.name, hint: summary.hint, envelope: await encryptWithMasterKey(content, key) },
                });
                if (updated.restriction) setSummary({ ...summary, restriction: updated.restriction });
                setPanel("none");
              }, "secret-block.error.save-failed")
            }
          />
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t("secret-block.restricted.limitations")}</p>
      </div>
      {errorLine}
    </Shell>
  );
};

type T = ReturnType<typeof useTranslate>;

const Shell = ({
  className,
  title,
  policy,
  t,
  children,
}: {
  className?: string;
  title: string;
  policy?: SecretBlockPolicy;
  t: T;
  children: ReactNode;
}) => (
  <div className={cn("my-2 rounded-lg border border-border bg-muted/30 overflow-hidden select-none", className)} {...blockCopyProps}>
    <div className="flex items-center gap-2 px-3 pt-2.5">
      <ShieldIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium text-foreground truncate">{title}</span>
      {policy && (
        <Badge variant="outline" className="text-[11px]">
          {policy.preset === SecretBlockPolicy_Preset.HIGH_IMPACT
            ? t("secret-block.restricted.badge-high")
            : t("secret-block.restricted.badge-low")}
        </Badge>
      )}
    </div>
    {children}
  </div>
);

interface RequestFormProps {
  policy: SecretBlockPolicy;
  emergency: boolean;
  emergencyStatement: string;
  busy: boolean;
  t: T;
  onSubmit: (confirmText: string, emergency?: { statement: string; reason: string }) => void;
}

const RequestForm = ({ policy, emergency, emergencyStatement, busy, t, onSubmit }: RequestFormProps) => {
  const [typed, setTyped] = useState("");
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const confirmOk = typedTextMatches(typed, policy.confirmText);
  const emergencyOk = !emergency || (typedTextMatches(statement, emergencyStatement) && emergencyReasonLongEnough(reason));

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmOk || !emergencyOk) return;
        onSubmit(typed, emergency ? { statement, reason } : undefined);
      }}
    >
      {policy.prompt && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("secret-block.restricted.prompt-title")}</span>
          <CanvasText text={policy.prompt} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("secret-block.restricted.confirm-instruction")}</span>
        <CanvasText text={policy.confirmText} />
        <Input
          autoComplete="off"
          spellCheck={false}
          className="h-8 text-sm"
          aria-label={t("secret-block.restricted.confirm-instruction")}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy}
          {...blockPasteProps}
        />
      </div>
      {emergency && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("secret-block.restricted.emergency-statement")}</span>
            <CanvasText text={emergencyStatement} />
            <Input
              autoComplete="off"
              spellCheck={false}
              className="h-8 text-sm"
              aria-label={t("secret-block.restricted.emergency-statement")}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              disabled={busy}
              {...blockPasteProps}
            />
          </div>
          <Textarea
            rows={2}
            className="text-sm"
            placeholder={t("secret-block.restricted.emergency-reason", { count: MIN_EMERGENCY_REASON_LENGTH })}
            aria-label={t("secret-block.restricted.emergency-reason", { count: MIN_EMERGENCY_REASON_LENGTH })}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            {...blockPasteProps}
          />
        </>
      )}
      <div>
        <Button type="submit" size="sm" variant={emergency ? "destructive" : "default"} disabled={busy || !confirmOk || !emergencyOk}>
          {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
          {emergency ? t("secret-block.restricted.emergency-submit") : t("secret-block.restricted.submit-request")}
        </Button>
      </div>
    </form>
  );
};

interface ReplaceFormProps {
  busy: boolean;
  passphraseField: ReactNode;
  needsPassphrase: boolean;
  t: T;
  onSubmit: (content: string) => void;
}

// Replacing writes a new secret without ever showing the old one, so it is
// allowed at any time.
const ReplaceForm = ({ busy, passphraseField, needsPassphrase, t, onSubmit }: ReplaceFormProps) => {
  const [content, setContent] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(content);
      }}
    >
      <span className="text-xs text-muted-foreground">{t("secret-block.restricted.replace-hint")}</span>
      <Textarea
        rows={3}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-sm"
        placeholder={t("secret-block.restricted.content-placeholder")}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        {passphraseField}
        <Button type="submit" size="sm" disabled={busy || needsPassphrase}>
          {t("secret-block.restricted.replace-save")}
        </Button>
      </div>
    </form>
  );
};

export interface PolicyDraft {
  preset: SecretBlockPolicy_Preset;
  prompt: string;
  confirmText: string;
}

interface PolicyFieldsProps {
  draft: PolicyDraft;
  onChange: (draft: PolicyDraft) => void;
  busy: boolean;
  t: T;
}

/** The preset choice and the two texts. Shared by creation and settings. */
export const PolicyFields = ({ draft, onChange, busy, t }: PolicyFieldsProps) => (
  <div className="flex flex-col gap-2">
    <fieldset className="flex flex-col gap-1" disabled={busy}>
      <legend className="text-xs font-medium text-muted-foreground mb-1">{t("secret-block.restricted.preset-label")}</legend>
      {[
        [SecretBlockPolicy_Preset.HIGH_IMPACT, "secret-block.restricted.preset-high"] as const,
        [SecretBlockPolicy_Preset.LOW_IMPACT, "secret-block.restricted.preset-low"] as const,
      ].map(([preset, label]) => (
        <label key={preset} className="flex items-start gap-2 text-sm">
          <input type="radio" className="mt-1" checked={draft.preset === preset} onChange={() => onChange({ ...draft, preset })} />
          <span>{t(label)}</span>
        </label>
      ))}
    </fieldset>
    <Textarea
      rows={2}
      className="text-sm"
      placeholder={t("secret-block.restricted.prompt-placeholder")}
      aria-label={t("secret-block.restricted.prompt-placeholder")}
      value={draft.prompt}
      onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
      disabled={busy}
    />
    <Input
      autoComplete="off"
      className="h-8 text-sm"
      placeholder={t("secret-block.restricted.confirm-text-placeholder")}
      aria-label={t("secret-block.restricted.confirm-text-placeholder")}
      value={draft.confirmText}
      onChange={(event) => onChange({ ...draft, confirmText: event.target.value })}
      disabled={busy}
    />
  </div>
);

export const policyFromDraft = (draft: PolicyDraft) => ({
  preset: draft.preset,
  timeZone: browserTimeZone(),
  prompt: draft.prompt.trim(),
  confirmText: draft.confirmText.trim(),
});
