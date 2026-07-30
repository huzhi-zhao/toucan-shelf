import { CheckIcon, CopyIcon, KeyRoundIcon, LoaderCircleIcon, LockIcon, LockOpenIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { createContext, type FormEvent, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { secretBlockServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Translations } from "@/utils/i18n";
import { useTranslate } from "@/utils/i18n";
import { isLocalSecretId, parseSecretBlock, rewriteSecretBlock, sanitizeSecretHint } from "@/utils/secret-block";
import {
  decryptSecret,
  encryptSecret,
  type SecretEnvelope,
  SecretFormatError,
  SecretIntegrityError,
  SecretPassphraseError,
} from "@/utils/secret-crypto";
import { useBlockSource } from "./BlockSourceContext";
import { MemoMarkdownRenderer } from "./MemoMarkdownRenderer";
import { extractCodeContent } from "./utils";

interface SecretBlockProps {
  children?: React.ReactNode;
  className?: string;
}

// A decrypted payload is rendered as markdown, so it could itself contain a
// `toucan-secret` fence. This flag stops that from nesting unlock cards inside
// unlock cards; nested fences fall through to a plain locked card with no form.
const InsideSecretBlock = createContext(false);

const NO_MENTIONS = new Set<string>();

type Status = "idle" | "working";

export const SecretBlock = ({ children, className }: SecretBlockProps) => {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const blockSource = useBlockSource();
  const nested = useContext(InsideSecretBlock);
  const ref = parseSecretBlock(extractCodeContent(children));

  // The passphrase is kept after unlocking, because saving an edit means
  // re-encrypting. It lives here and nowhere else, and dies with the component.
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [hintDraft, setHintDraft] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState<Translations | "">("");
  const [errorDetail, setErrorDetail] = useState("");
  const [copied, setCopied] = useState(false);
  // Rotation state. Held separately from `passphrase` so a half-typed new
  // passphrase can never be used to re-encrypt.
  const [rotating, setRotating] = useState(false);
  const [nextPassphrase, setNextPassphrase] = useState("");
  const [nextConfirmation, setNextConfirmation] = useState("");

  const refId = ref?.id;
  const refHint = ref?.hint ?? "";

  // Any change of identity relocks. Together with state being component-local,
  // this is what makes a reload — or any remount — return to the passphrase prompt.
  useEffect(() => {
    setPassphrase("");
    setConfirmation("");
    setPlaintext(null);
    setDraft(null);
    setErrorKey("");
    setErrorDetail("");
    setStatus("idle");
    setRotating(false);
    setNextPassphrase("");
    setNextConfirmation("");
  }, [refId]);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (copyTimer.current ? clearTimeout(copyTimer.current) : undefined), []);

  const title = refHint || t("secret-block.locked");

  if (!ref) {
    return <SecretNotice className={className} tone="warning" title={t("secret-block.malformed")} />;
  }
  if (nested) {
    return <SecretNotice className={className} tone="muted" title={title} />;
  }
  if (!currentUser) {
    return <SecretNotice className={className} tone="muted" title={t("secret-block.sign-in-required")} />;
  }

  // A local id means the block has been written but never initialized: there is no
  // record to fetch and no passphrase yet, so the action is "set a passphrase".
  const uninitialized = isLocalSecretId(ref.id);
  const busy = status === "working";

  const fail = (key: Translations, detail = "") => {
    setErrorKey(key);
    setErrorDetail(detail);
    setStatus("idle");
  };

  const fetchEnvelope = async (): Promise<SecretEnvelope | null> => {
    try {
      const record = await secretBlockServiceClient.getSecretBlock({ name: `secretBlocks/${ref.id}` });
      if (!record.envelope) return null;
      const e = record.envelope;
      return {
        kdf: e.kdf,
        kdfIterations: e.kdfIterations,
        cipher: e.cipher,
        salt: e.salt,
        nonce: e.nonce,
        verifier: e.verifier,
        ciphertext: e.ciphertext,
      };
    } catch {
      return null;
    }
  };

  // Initialize: create the record, then write its uid back into the document. The
  // write-back is what turns this block from a local placeholder into a reference.
  const initialize = async (event: FormEvent) => {
    event.preventDefault();
    if (passphrase === "" || passphrase !== confirmation || busy) return;
    if (!blockSource || blockSource.readonly) {
      fail("secret-block.error.readonly");
      return;
    }
    setStatus("working");
    setErrorKey("");

    try {
      const hint = sanitizeSecretHint(hintDraft);
      const envelope = await encryptSecret("", passphrase);
      const created = await secretBlockServiceClient.createSecretBlock({
        secretBlock: { name: "", hint, envelope },
      });
      const uid = created.name.replace(/^secretBlocks\//, "");

      const nextSource = rewriteSecretBlock(blockSource.source, ref.id, { id: uid, hint });
      if (nextSource === null) {
        // The record exists but we cannot point the document at it. Say so rather
        // than leaving the user believing their secret was saved somewhere reachable.
        fail("secret-block.error.write-back-failed", uid);
        return;
      }
      blockSource.save(nextSource);

      setConfirmation("");
      setPlaintext("");
      setDraft("");
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.create-failed", err instanceof Error ? err.message : String(err));
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (passphrase === "" || busy) return;
    setStatus("working");
    setErrorKey("");

    const envelope = await fetchEnvelope();
    if (!envelope) {
      fail("secret-block.error.not-found");
      return;
    }
    try {
      const text = await decryptSecret(envelope, passphrase);
      setPlaintext(text);
      setStatus("idle");
    } catch (error) {
      // Three outcomes, three messages. Someone whose ciphertext is damaged must not
      // be left retrying a passphrase they remember perfectly well.
      if (error instanceof SecretPassphraseError) fail("secret-block.error.wrong-passphrase");
      else if (error instanceof SecretIntegrityError) fail("secret-block.error.corrupted");
      else if (error instanceof SecretFormatError) fail("secret-block.error.unsupported");
      else fail("secret-block.error.corrupted");
    }
  };

  const saveContent = async () => {
    if (draft === null || busy) return;
    setStatus("working");
    setErrorKey("");
    try {
      const envelope = await encryptSecret(draft, passphrase);
      await secretBlockServiceClient.updateSecretBlock({
        secretBlock: { name: `secretBlocks/${ref.id}`, hint: refHint, envelope },
      });
      setPlaintext(draft);
      setDraft(null);
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.save-failed", err instanceof Error ? err.message : String(err));
    }
  };

  // Rotating re-encrypts the current plaintext under a new passphrase and
  // overwrites the record. Overwriting is only meaningful because the envelope
  // lives in its own row: inline in the document, the old envelope would survive
  // in version history and git, and the old passphrase would still open it.
  const rotatePassphrase = async () => {
    if (plaintext === null || nextPassphrase === "" || nextPassphrase !== nextConfirmation || busy) return;
    setStatus("working");
    setErrorKey("");
    try {
      const envelope = await encryptSecret(plaintext, nextPassphrase);
      await secretBlockServiceClient.updateSecretBlock({
        secretBlock: { name: `secretBlocks/${ref.id}`, hint: refHint, envelope },
      });
      setPassphrase(nextPassphrase);
      setNextPassphrase("");
      setNextConfirmation("");
      setRotating(false);
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.rotate-failed", err instanceof Error ? err.message : String(err));
    }
  };

  const cancelRotation = () => {
    setRotating(false);
    setNextPassphrase("");
    setNextConfirmation("");
    setErrorKey("");
  };

  const relock = () => {
    setPassphrase("");
    setPlaintext(null);
    setDraft(null);
    setErrorKey("");
    cancelRotation();
  };

  const copy = async () => {
    if (plaintext === null) return;
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const errorLine = errorKey ? (
    <p className="flex items-start gap-1.5 px-3 pb-2.5 text-xs text-destructive" role="alert">
      <TriangleAlertIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>
        {t(errorKey)}
        {errorDetail && <span className="opacity-70"> ({errorDetail})</span>}
      </span>
    </p>
  ) : null;

  // ---- Open: decrypted, viewing or editing -------------------------------

  if (plaintext !== null) {
    const editing = draft !== null;
    return (
      <div className={cn("my-2 rounded-lg border border-border bg-card overflow-hidden", className)}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
          <LockOpenIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
          <div className="flex-1" />
          {editing ? (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" disabled={busy} onClick={saveContent}>
                {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={copy} aria-label={t("secret-block.copy")}>
                {copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(plaintext)} aria-label={t("secret-block.edit")}>
                <PencilIcon className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRotating((open) => !open)}
                aria-label={t("secret-block.change-passphrase")}
              >
                <KeyRoundIcon className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={relock}>
                <LockIcon className="w-4 h-4" />
                {t("secret-block.relock")}
              </Button>
            </>
          )}
        </div>

        {rotating && !editing && (
          <form
            className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/20"
            onSubmit={(event) => {
              event.preventDefault();
              rotatePassphrase();
            }}
          >
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 w-full max-w-56 text-sm"
              placeholder={t("secret-block.new-passphrase")}
              aria-label={t("secret-block.new-passphrase")}
              value={nextPassphrase}
              onChange={(event) => setNextPassphrase(event.target.value)}
              disabled={busy}
            />
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 w-full max-w-56 text-sm"
              placeholder={t("secret-block.create.passphrase-confirm")}
              aria-label={t("secret-block.create.passphrase-confirm")}
              value={nextConfirmation}
              onChange={(event) => setNextConfirmation(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy || nextPassphrase === "" || nextPassphrase !== nextConfirmation}>
              {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
              {t("secret-block.change-passphrase")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancelRotation}>
              {t("common.cancel")}
            </Button>
            {nextConfirmation !== "" && nextPassphrase !== nextConfirmation && (
              <span className="w-full text-xs text-destructive">{t("secret-block.create.passphrase-mismatch")}</span>
            )}
          </form>
        )}

        {editing ? (
          <Textarea
            rows={6}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="rounded-none border-0 font-mono text-sm focus-visible:ring-0"
            placeholder={t("secret-block.content-placeholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : plaintext === "" ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">{t("secret-block.empty")}</p>
        ) : (
          <div className="px-3 py-2">
            {/* The payload is the user's own markdown, so it renders like any other
                content — but never with another unlock card nested inside it. */}
            <InsideSecretBlock.Provider value={true}>
              <MemoMarkdownRenderer content={plaintext} resolvedMentionUsernames={NO_MENTIONS} />
            </InsideSecretBlock.Provider>
          </div>
        )}
        {errorLine}
      </div>
    );
  }

  // ---- Closed: initialize or unlock ---------------------------------------

  return (
    <div className={cn("my-2 rounded-lg border border-border bg-muted/30 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground truncate">{title}</span>
        {uninitialized && <span className="text-xs text-muted-foreground">{t("secret-block.uninitialized")}</span>}
      </div>

      <form className="flex flex-col gap-2 px-3 py-2.5" onSubmit={uninitialized ? initialize : unlock}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            autoComplete={uninitialized ? "new-password" : "off"}
            className="h-8 w-full max-w-56 text-sm"
            placeholder={t("secret-block.passphrase-placeholder")}
            aria-label={t("secret-block.passphrase-placeholder")}
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value);
              if (errorKey) setErrorKey("");
            }}
            disabled={busy}
          />
          {uninitialized && (
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 w-full max-w-56 text-sm"
              placeholder={t("secret-block.create.passphrase-confirm")}
              aria-label={t("secret-block.create.passphrase-confirm")}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
            />
          )}
          <Button type="submit" size="sm" disabled={busy || passphrase === "" || (uninitialized && passphrase !== confirmation)}>
            {busy ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <LockOpenIcon className="w-4 h-4" />}
            {uninitialized ? t("secret-block.set-passphrase") : t("secret-block.unlock")}
          </Button>
        </div>

        {uninitialized && (
          <>
            <Input
              type="text"
              autoComplete="off"
              className="h-8 w-full max-w-96 text-sm"
              placeholder={t("secret-block.hint-placeholder")}
              aria-label={t("secret-block.hint-placeholder")}
              value={hintDraft}
              onChange={(event) => setHintDraft(event.target.value)}
              disabled={busy}
            />
            {confirmation !== "" && passphrase !== confirmation && (
              <span className="text-xs text-destructive">{t("secret-block.create.passphrase-mismatch")}</span>
            )}
            <span className="text-xs text-muted-foreground">{t("secret-block.create.no-recovery")}</span>
          </>
        )}
      </form>
      {errorLine}
    </div>
  );
};

// Terminal states that offer no action: nothing to type, nothing to retry.
const SecretNotice = ({ className, tone, title }: { className?: string; tone: "muted" | "warning"; title: string }) => (
  <div
    className={cn(
      "my-2 flex items-center gap-2 rounded-lg border px-3 py-2.5",
      tone === "warning" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30",
      className,
    )}
  >
    {tone === "warning" ? (
      <TriangleAlertIcon className="w-4 h-4 shrink-0 text-destructive" />
    ) : (
      <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
    )}
    <span className={cn("text-sm", tone === "warning" ? "text-destructive" : "text-muted-foreground")}>{title}</span>
  </div>
);
