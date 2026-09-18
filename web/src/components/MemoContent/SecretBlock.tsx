import { CheckIcon, CopyIcon, LoaderCircleIcon, LockIcon, LockOpenIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import { createContext, type FormEvent, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/masked-input";
import { Textarea } from "@/components/ui/textarea";
import { secretBlockServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { useSecretMasterKey } from "@/hooks/useSecretMasterKey";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import type { Translations } from "@/utils/i18n";
import { useTranslate } from "@/utils/i18n";
import { isLocalSecretId, parseSecretBlock, rewriteSecretBlock, sanitizeSecretHint } from "@/utils/secret-block";
import {
  decryptWithMasterKey,
  encryptWithMasterKey,
  isMasterEnvelope,
  type SecretEnvelope,
  SecretFormatError,
  SecretIntegrityError,
  SecretPassphraseError,
} from "@/utils/secret-crypto";
import { getSecretMasterKey } from "@/utils/secret-session";
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

const SETTINGS_LINK = `${ROUTES.SETTING}#preference`;

type Status = "idle" | "working";

/**
 * Whether the first fetch has resolved this block's envelope.
 *
 * Every block is encrypted against the account's master key, so there is nothing
 * to learn about *which* key opens it — but the card still cannot know, before
 * that fetch, whether it will need to ask for the master passphrase. False means
 * "not fetched yet", which is why the closed card shows a single neutral action
 * until the first fetch resolves it.
 */

export const SecretBlock = ({ children, className }: SecretBlockProps) => {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const blockSource = useBlockSource();
  const nested = useContext(InsideSecretBlock);
  const masterKeyState = useSecretMasterKey();
  const ref = parseSecretBlock(extractCodeContent(children));

  const [hintDraft, setHintDraft] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState<Translations | "">("");
  const [errorDetail, setErrorDetail] = useState("");
  const [copied, setCopied] = useState(false);

  const [keyResolved, setKeyResolved] = useState(false);
  // The envelope is cached once fetched so that a wrong passphrase, or a retry
  // after learning the key mode, does not re-hit the server for bytes we hold.
  const [envelope, setEnvelope] = useState<SecretEnvelope | null>(null);
  // The account's master passphrase, held only long enough to unlock the session.
  // The block itself keeps no key material: what opens it is the session's master
  // key, not anything this component stores.
  const [passphrase, setPassphrase] = useState("");

  const refId = ref?.id;
  const refHint = ref?.hint ?? "";

  // Any change of identity relocks. Together with state being component-local,
  // this is what makes a reload — or any remount — return to the locked card.
  useEffect(() => {
    setPlaintext(null);
    setDraft(null);
    setErrorKey("");
    setErrorDetail("");
    setStatus("idle");
    setKeyResolved(false);
    setEnvelope(null);
    setPassphrase("");
  }, [refId]);

  // Locking the session — by the idle timer, by the global lock, by signing out —
  // has to close master blocks that are currently open. Leaving them rendered
  // would make the lock cosmetic.
  useEffect(() => {
    if (!masterKeyState.unlocked && keyResolved) {
      setPlaintext(null);
      setDraft(null);
    }
  }, [masterKeyState.unlocked, keyResolved]);

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
  // record to fetch, and the only thing left to decide is its label.
  const uninitialized = isLocalSecretId(ref.id);
  const busy = status === "working";

  const fail = (key: Translations, detail = "") => {
    setErrorKey(key);
    setErrorDetail(detail);
    setStatus("idle");
  };

  const reportCryptoFailure = (error: unknown) => {
    // Three outcomes, three messages. Someone whose ciphertext is damaged must not
    // be left retrying a passphrase they remember perfectly well.
    if (error instanceof SecretPassphraseError) fail("secret-block.error.wrong-passphrase");
    else if (error instanceof SecretIntegrityError) fail("secret-block.error.corrupted");
    else if (error instanceof SecretFormatError) fail("secret-block.error.unsupported");
    else fail("secret-block.error.corrupted");
  };

  const fetchEnvelope = async (): Promise<SecretEnvelope | null> => {
    if (envelope) return envelope;
    try {
      const record = await secretBlockServiceClient.getSecretBlock({ name: `secretBlocks/${ref.id}` });
      if (!record.envelope) return null;
      const e = record.envelope;
      const fetched: SecretEnvelope = {
        kdf: e.kdf,
        kdfIterations: e.kdfIterations,
        cipher: e.cipher,
        salt: e.salt,
        nonce: e.nonce,
        verifier: e.verifier,
        ciphertext: e.ciphertext,
      };
      setEnvelope(fetched);
      return fetched;
    } catch {
      return null;
    }
  };

  // Initialize: create the record, then write its uid back into the document. The
  // write-back is what turns this block from a local placeholder into a reference.
  //
  // There is no passphrase to choose here — the account's master key does the
  // encrypting — so the only decision left is the label. The passphrase field
  // appears only when the session is locked, and unlocking it is then a step on
  // the way to creating rather than a separate errand.
  const initialize = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!blockSource || blockSource.readonly) {
      fail("secret-block.error.readonly");
      return;
    }
    setStatus("working");
    setErrorKey("");

    let masterKey = getSecretMasterKey();
    if (!masterKey) {
      try {
        await masterKeyState.unlock(passphrase);
      } catch (error) {
        reportCryptoFailure(error);
        return;
      }
      masterKey = getSecretMasterKey();
      if (!masterKey) {
        fail("secret-block.error.locked-session");
        return;
      }
      setPassphrase("");
    }

    try {
      const hint = sanitizeSecretHint(hintDraft);
      const created = await secretBlockServiceClient.createSecretBlock({
        secretBlock: { name: "", hint, envelope: await encryptWithMasterKey("", masterKey) },
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

      setKeyResolved(true);
      setPlaintext("");
      setDraft("");
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.create-failed", err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Opens the block, asking for as little as the situation allows.
   *
   * The flow is written to handle "we have not fetched yet": it may resolve
   * immediately, or come back needing the master passphrase, which the card can
   * only prompt for once it knows a fetch succeeded.
   */
  const unlock = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setStatus("working");
    setErrorKey("");

    const env = await fetchEnvelope();
    if (!env) {
      fail("secret-block.error.not-found");
      return;
    }
    // Every stored envelope is a master-key one. A suite this build cannot open
    // is a corrupt or forward-dated record, not a mode to fall back to.
    if (!isMasterEnvelope(env)) {
      fail("secret-block.error.unsupported");
      return;
    }

    setKeyResolved(true);
    let masterKey = getSecretMasterKey();
    if (!masterKey) {
      if (passphrase === "") {
        // Now that the fetch has resolved the card can render the prompt. The
        // user sees one field appear, not an error.
        setStatus("idle");
        return;
      }
      try {
        await masterKeyState.unlock(passphrase);
      } catch (error) {
        reportCryptoFailure(error);
        return;
      }
      masterKey = getSecretMasterKey();
      if (!masterKey) {
        fail("secret-block.error.locked-session");
        return;
      }
    }
    try {
      setPlaintext(await decryptWithMasterKey(env, masterKey));
      setPassphrase("");
      setStatus("idle");
    } catch (error) {
      reportCryptoFailure(error);
    }
  };

  // Writes an envelope back under the account's master key.
  const sealCurrent = async (text: string): Promise<SecretEnvelope> => {
    const masterKey = getSecretMasterKey();
    if (!masterKey) {
      throw new SecretFormatError("session is locked");
    }
    return encryptWithMasterKey(text, masterKey);
  };

  const persistEnvelope = async (next: SecretEnvelope) => {
    await secretBlockServiceClient.updateSecretBlock({
      secretBlock: { name: `secretBlocks/${ref.id}`, hint: refHint, envelope: next },
    });
    setEnvelope(next);
  };

  const saveContent = async () => {
    if (draft === null || busy) return;
    setStatus("working");
    setErrorKey("");
    try {
      await persistEnvelope(await sealCurrent(draft));
      setPlaintext(draft);
      setDraft(null);
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.save-failed", err instanceof Error ? err.message : String(err));
    }
  };

  const relock = () => {
    setPlaintext(null);
    setDraft(null);
    setErrorKey("");
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
              <Button variant="ghost" size="sm" onClick={relock}>
                <LockIcon className="w-4 h-4" />
                {t("secret-block.relock")}
              </Button>
            </>
          )}
        </div>

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

  // ---- Closed -------------------------------------------------------------

  // A block cannot be created before there is a key to encrypt it with, and that
  // key is set once for the account rather than once per block. Point at where.
  if (uninitialized && !masterKeyState.configured && !masterKeyState.loading) {
    return (
      <div className={cn("my-2 rounded-lg border border-border bg-muted/30 overflow-hidden", className)}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("secret-block.no-master-key")}</span>
          <Link className="text-sm text-primary underline" to={SETTINGS_LINK}>
            {t("secret-block.set-up-master")}
          </Link>
        </div>
      </div>
    );
  }

  // The passphrase field only appears once the first fetch has resolved. Before
  // that a single button is the whole interface — and in an unlocked session it
  // stays that way.
  const needsPassphrase = uninitialized ? !masterKeyState.unlocked : keyResolved && !masterKeyState.unlocked;
  const promptKey: Translations = "secret-block.master-passphrase-placeholder";

  return (
    <div className={cn("my-2 rounded-lg border border-border bg-muted/30 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground truncate">{title}</span>
        {uninitialized && <span className="text-xs text-muted-foreground">{t("secret-block.uninitialized")}</span>}
      </div>

      <form className="flex flex-col gap-2 px-3 py-2.5" onSubmit={uninitialized ? initialize : unlock}>
        <div className="flex flex-wrap items-center gap-2">
          {uninitialized && (
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
          )}
          {needsPassphrase && (
            <MaskedInput
              revealable
              autoFocus={!uninitialized}
              className="h-8 w-full max-w-56 text-sm"
              placeholder={t(promptKey)}
              aria-label={t(promptKey)}
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (errorKey) setErrorKey("");
              }}
              disabled={busy}
            />
          )}
          <Button type="submit" size="sm" disabled={busy || (needsPassphrase && passphrase === "")}>
            {busy ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <LockOpenIcon className="w-4 h-4" />}
            {uninitialized ? t("secret-block.create-block") : t("secret-block.unlock")}
          </Button>
        </div>

        {uninitialized && needsPassphrase && <span className="text-xs text-muted-foreground">{t("secret-block.unlock-first")}</span>}
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
