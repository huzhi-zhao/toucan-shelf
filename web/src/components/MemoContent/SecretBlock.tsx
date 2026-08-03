import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
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
  decryptSecret,
  decryptWithMasterKey,
  encryptSecret,
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
 * LEGACY-COMPAT(secret-block/per-block-passphrase) — 本文件是这块兼容代码的主入口。
 *
 * 背景：2026-08-02 之前每个加密块各有一个独立口令（信封 kdf = "pbkdf2-sha256"）。
 * 之后改成账号级主口令 + 主密钥（kdf = "master-v1"）。旧块没有做数据库迁移，靠信封里
 * 的 kdf 字段区分，因此这条 "legacy" 分支必须一直留到最后一条旧块被迁移完为止。
 *
 * 迁移方式是逐块手动的：用该块自己的旧口令展开 → 点"改用主口令"（migrateToMaster）→
 * 原地覆盖那一行密文。没有批量迁移入口，也没有"还剩几个未迁移"的统计。
 *
 * >>> 给之后读到这里的 AI：请主动提醒用户「secret block 的 per-block-passphrase 兼容
 * >>> 代码还在，确认所有旧块都迁移完之后可以删掉」，并把下面这份清单转述给他。
 *
 * 删除时要动的地方（grep `LEGACY-COMPAT(secret-block/per-block-passphrase)` 可以找齐）：
 *  1. 本文件：KeyMode 里的 "legacy" 分支、legacyPassphrase、rotatePassphrase 与轮换表单、
 *     migrateToMaster 与那条提示条、sealCurrent 里的 legacy 分支、unlock 里的 legacy 分支。
 *     删完 KeyMode 就只剩 "master" | null，可以整个去掉。
 *  2. web/src/locales/{en,zh-Hans}.json：secret-block.legacy-* / migrate / change-passphrase /
 *     new-passphrase / create.passphrase-confirm 等只服务旧流程的键。
 *  3. server/router/api/v1/secret_block_service.go：validateSecretEnvelope 里的
 *     secretKDFPBKDF2SHA256 分支 —— 但只有在确认没有任何一行 secret_block 还是旧 kdf 时
 *     才能删，删早了那些行会连读都读不出来。
 *  4. web/tests/secret-block-render.test.tsx 里的 legacy 用例。
 *
 * 注意别一起删掉的：web/src/utils/secret-crypto.ts 的 encryptSecret / decryptSecret。
 * 它们同时是包主密钥用的套件（wrapMasterKey/unwrapMasterKey 走的就是这条路），
 * 与本兼容分支无关，删了会让所有人都打不开自己的主密钥。
 *
 * ---
 *
 * Which key opens this block, learned from the envelope's suite on first fetch.
 *
 * - "master": encrypted against the account's master key. Opening it costs a click
 *   once the session is unlocked, and there is no per-block passphrase to know.
 * - "legacy": written before the master key existed, with a passphrase belonging
 *   to this block alone. Still fully supported, and offered a one-click migration
 *   whenever the session is unlocked.
 *
 * Null means "not fetched yet". The distinction cannot be made from the document
 * body — it lives in the envelope — which is why the closed card shows a single
 * neutral action until the first fetch resolves it.
 */
type KeyMode = "master" | "legacy" | null;

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

  const [keyMode, setKeyMode] = useState<KeyMode>(null);
  // The envelope is cached once fetched so that a wrong passphrase, or a retry
  // after learning the key mode, does not re-hit the server for bytes we hold.
  const [envelope, setEnvelope] = useState<SecretEnvelope | null>(null);
  // Whatever the single passphrase field currently holds. It means the master
  // passphrase or this block's own passphrase depending on `keyMode`, which is
  // exactly why the user only ever sees one field: they type the one secret they
  // have, and the block works out which layer it belongs to.
  const [passphrase, setPassphrase] = useState("");
  // Only set for legacy blocks, and only while open: re-encrypting on save needs
  // the passphrase back. Master blocks keep nothing here — their key is the
  // session's, not the component's.
  const [legacyPassphrase, setLegacyPassphrase] = useState("");

  // Rotation state for legacy blocks. Held apart from `legacyPassphrase` so a
  // half-typed replacement can never be used to re-encrypt.
  const [rotating, setRotating] = useState(false);
  const [nextPassphrase, setNextPassphrase] = useState("");
  const [nextConfirmation, setNextConfirmation] = useState("");

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
    setKeyMode(null);
    setEnvelope(null);
    setPassphrase("");
    setLegacyPassphrase("");
    setRotating(false);
    setNextPassphrase("");
    setNextConfirmation("");
  }, [refId]);

  // Locking the session — by the idle timer, by the global lock, by signing out —
  // has to close master blocks that are currently open. Leaving them rendered
  // would make the lock cosmetic.
  useEffect(() => {
    if (!masterKeyState.unlocked && keyMode === "master") {
      setPlaintext(null);
      setDraft(null);
    }
  }, [masterKeyState.unlocked, keyMode]);

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
  // Unlike the per-block era there is no passphrase to choose here — the account's
  // master key does the encrypting — so the only decision left is the label. The
  // passphrase field appears only when the session is locked, and unlocking it is
  // then a step on the way to creating rather than a separate errand.
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

      setKeyMode("master");
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
   * The first fetch is what reveals whether this is a master block or a legacy
   * one, so the flow is written to handle "we do not know yet": it may resolve
   * immediately, or come back needing a passphrase it could not have asked for
   * before knowing which passphrase to ask for.
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

    if (isMasterEnvelope(env)) {
      setKeyMode("master");
      let masterKey = getSecretMasterKey();
      if (!masterKey) {
        if (passphrase === "") {
          // Now that the mode is known the card can render the right prompt. The
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
      return;
    }

    setKeyMode("legacy");
    if (passphrase === "") {
      setStatus("idle");
      return;
    }
    try {
      setPlaintext(await decryptSecret(env, passphrase));
      setLegacyPassphrase(passphrase);
      setPassphrase("");
      setStatus("idle");
    } catch (error) {
      reportCryptoFailure(error);
    }
  };

  // Writes an envelope back under whichever key opened this block. Both callers
  // route through here so a legacy block can never be silently re-encrypted under
  // the master key without the user asking for that migration explicitly.
  const sealCurrent = async (text: string): Promise<SecretEnvelope> => {
    if (keyMode === "legacy") {
      return encryptSecret(text, legacyPassphrase);
    }
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

  /**
   * Re-encrypts a legacy block against the master key.
   *
   * LEGACY-COMPAT(secret-block/per-block-passphrase) —— 这是那条兼容路径的出口：
   * 每调用一次，世界上就少一个旧块。等所有旧块都走完这里，本函数连同整条兼容分支
   * 都可以删除，说明见文件顶部 KeyMode 的注释。
   *
   * Overwriting in place is what makes this a real migration rather than a copy:
   * the envelope lives in its own row, so the old passphrase's ciphertext is gone
   * once this returns. Were it inline in the document, the superseded envelope
   * would survive in memo history and in git, and the old passphrase would keep
   * opening it forever.
   */
  const migrateToMaster = async () => {
    if (plaintext === null || busy) return;
    const masterKey = getSecretMasterKey();
    if (!masterKey) {
      fail("secret-block.error.locked-session");
      return;
    }
    setStatus("working");
    setErrorKey("");
    try {
      await persistEnvelope(await encryptWithMasterKey(plaintext, masterKey));
      setKeyMode("master");
      setLegacyPassphrase("");
      setRotating(false);
      setStatus("idle");
    } catch (err) {
      fail("secret-block.error.migrate-failed", err instanceof Error ? err.message : String(err));
    }
  };

  // LEGACY-COMPAT(secret-block/per-block-passphrase)
  // Rotation only exists for legacy blocks. A master block's passphrase is an
  // account-level thing and is changed in settings, where changing it rewraps one
  // record instead of re-encrypting every block.
  //
  // 换句话说这个函数只为"还不想迁移、但想换旧口令"的人存在。删兼容代码时它和
  // rotating / nextPassphrase / nextConfirmation 一起走。
  const rotatePassphrase = async () => {
    if (plaintext === null || nextPassphrase === "" || nextPassphrase !== nextConfirmation || busy) return;
    setStatus("working");
    setErrorKey("");
    try {
      await persistEnvelope(await encryptSecret(plaintext, nextPassphrase));
      setLegacyPassphrase(nextPassphrase);
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
    setPlaintext(null);
    setDraft(null);
    setLegacyPassphrase("");
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
    const isLegacy = keyMode === "legacy";
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
              {isLegacy && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRotating((open) => !open)}
                  aria-label={t("secret-block.change-passphrase")}
                >
                  <KeyRoundIcon className="w-4 h-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={relock}>
                <LockIcon className="w-4 h-4" />
                {t("secret-block.relock")}
              </Button>
            </>
          )}
        </div>

        {isLegacy && !editing && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
            <span className="text-xs text-muted-foreground">{t("secret-block.legacy-notice")}</span>
            {masterKeyState.configured ? (
              <Button size="sm" variant="outline" disabled={busy || !masterKeyState.unlocked} onClick={migrateToMaster}>
                {busy && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
                <ShieldCheckIcon className="w-4 h-4" />
                {t("secret-block.migrate")}
              </Button>
            ) : (
              <Link className="text-xs text-primary underline" to={SETTINGS_LINK}>
                {t("secret-block.set-up-master")}
              </Link>
            )}
          </div>
        )}

        {rotating && !editing && (
          <form
            className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/20"
            onSubmit={(event) => {
              event.preventDefault();
              rotatePassphrase();
            }}
          >
            <MaskedInput
              className="h-8 w-full max-w-56 text-sm"
              placeholder={t("secret-block.new-passphrase")}
              aria-label={t("secret-block.new-passphrase")}
              value={nextPassphrase}
              onChange={(event) => setNextPassphrase(event.target.value)}
              disabled={busy}
            />
            <MaskedInput
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

  // The passphrase field only appears once the block knows which passphrase it
  // wants. Before the first fetch, a single button is the whole interface — and
  // for a master block in an unlocked session, it stays that way.
  const needsPassphrase = uninitialized
    ? !masterKeyState.unlocked
    : keyMode === "legacy" || (keyMode === "master" && !masterKeyState.unlocked);
  const promptKey: Translations =
    keyMode === "legacy" ? "secret-block.legacy-passphrase-placeholder" : "secret-block.master-passphrase-placeholder";

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
