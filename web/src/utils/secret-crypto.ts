// Client-side encryption for `toucan-secret` blocks.
//
// Everything here runs in the browser. The passphrase never leaves this module's
// call stack, and the server only ever receives a SecretEnvelope. There is
// deliberately no server-side counterpart to this file.
//
// There are two suites, distinguished by the envelope's `kdf` field. Storing the
// algorithm name per record is what lets both coexist without a data migration:
// each envelope is opened with the parameters it was written with.
//
// "pbkdf2-sha256" — the original per-block passphrase suite. Each block derives
// its keys straight from a passphrase the user types at that block:
//
// !! 关于 LEGACY-COMPAT(secret-block/per-block-passphrase)：这个套件**不是**纯兼容代码，
// !! 不要跟着旧块一起删。清理旧块兼容代码时它必须原样保留 —— "master-v1" 用它来包/解包
// !! 主密钥（见下面 wrapMasterKey / unwrapMasterKey），删掉等于所有用户的主密钥全部报废。
// !! 该删的是 SecretBlock.tsx 里"用它直接加密块内容"的那条分支，不是这里的实现。
//
//   ikm      = PBKDF2-SHA256(passphrase, salt, iterations, 256 bit)
//   encKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/enc") -> AES-256-GCM
//   macKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/mac") -> HMAC-SHA256
//   verifier = HMAC(macKey, aad)
//   payload  = AES-256-GCM(encKey, nonce, plaintext, additionalData = aad)
//
// "master-v1" — the current suite. Blocks derive from a 256-bit random master key
// held for the session, and the passphrase only ever guards the master key:
//
//   MK       = 32 random bytes, generated once, never changes
//   wrapped  = a "pbkdf2-sha256" envelope whose plaintext is base64(MK)
//   encKey   = HKDF-SHA256(MK, salt, info="toucan-secret/v1/enc") -> AES-256-GCM
//   macKey   = HKDF-SHA256(MK, salt, info="toucan-secret/v1/mac") -> HMAC-SHA256
//
// The indirection buys three things the per-block suite could not have. Changing
// the passphrase rewraps one record instead of re-encrypting every block, so it
// cannot half-fail. Opening a page runs the expensive KDF once rather than once
// per block. And a block's key is 256 bits of real entropy regardless of how weak
// the passphrase is — the passphrase's entropy only has to hold up at the wrapping
// layer, which is also why that layer can afford a much higher iteration count.

export const SECRET_KDF_PBKDF2_SHA256 = "pbkdf2-sha256";
export const SECRET_KDF_MASTER_V1 = "master-v1";
export const SECRET_CIPHER_AES_256_GCM = "aes-256-gcm";

// OWASP's current floor for PBKDF2-SHA256. This is the only thing standing between
// a leaked database and the plaintext, so it is not a performance knob to trim.
export const SECRET_DEFAULT_ITERATIONS = 600_000;

// The cost for wrapping the master key. It is deliberately higher than the
// per-block figure above: under "master-v1" this KDF runs once per session
// instead of once per block, so the budget that used to be spread across every
// block on a page can be spent entirely on the one derivation that matters.
export const SECRET_MASTER_ITERATIONS = 1_200_000;

// Anything below this is treated as a corrupted or downgraded envelope rather than
// something to honor: an attacker who could rewrite `kdf_iterations` down to 1
// would otherwise make brute force free.
const MIN_ITERATIONS = 100_000;
// Guards against a hostile record wedging the tab in an unbounded derivation.
const MAX_ITERATIONS = 10_000_000;

const SALT_BYTES = 16;
// "master-v1" salts are HKDF salts rather than PBKDF2 salts, and are generated at
// full output width. Sized separately so a legacy envelope relabelled as master
// (or vice versa) fails parsing instead of being derived with the wrong scheme.
const MASTER_SALT_BYTES = 32;
const MASTER_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const VERIFIER_BYTES = 32;
// AES-GCM appends a 16-byte tag, so even empty plaintext produces this much.
const MIN_CIPHERTEXT_BYTES = 16;

export interface SecretEnvelope {
  kdf: string;
  kdfIterations: number;
  cipher: string;
  salt: string;
  nonce: string;
  verifier: string;
  ciphertext: string;
}

// The envelope is structurally invalid, or its parameters are not a suite we
// support. Distinct from a decryption failure: no passphrase would help.
export class SecretFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretFormatError";
  }
}

// The passphrase is wrong. Established by the verifier before any decryption is
// attempted, so this is a positive result rather than an inference from failure.
export class SecretPassphraseError extends Error {
  constructor() {
    super("incorrect passphrase");
    this.name = "SecretPassphraseError";
  }
}

// The passphrase is right but the ciphertext does not authenticate — the stored
// bytes have been altered or truncated. The user needs a backup, not another guess
// at the password, which is the whole reason the verifier exists.
export class SecretIntegrityError extends Error {
  constructor() {
    super("ciphertext failed authentication");
    this.name = "SecretIntegrityError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = (value: string, field: string): Uint8Array => {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new SecretFormatError(`${field} is not valid base64`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// canonicalAad builds the additional authenticated data: a canonical rendering of
// the envelope's parameters. Binding these means a tampered parameter header fails
// authentication instead of quietly changing how the payload is interpreted.
//
// It deliberately does NOT include the referencing memo's uid. Binding the document
// would confine a record to one document, but secret records belong to the user and
// are legitimately referenced from several documents (a copied page references the
// same record) — see the plan's "记录归属用户" decision.
const canonicalAad = (kdf: string, iterations: number, cipher: string): Uint8Array => {
  return encoder.encode(`toucan-secret/v1\nkdf:${kdf}\niter:${iterations}\ncipher:${cipher}\n`);
};

interface DerivedKeys {
  encKey: CryptoKey;
  macKey: CryptoKey;
}

// splitKeys turns one high-entropy secret into two independent keys, so the value
// that proves the key is never the value that decrypts the payload.
const splitKeys = async (ikm: BufferSource, hkdfSalt: Uint8Array): Promise<DerivedKeys> => {
  const hkdfKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);

  const [encKey, macKey] = await Promise.all([
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: hkdfSalt as BufferSource, info: encoder.encode("toucan-secret/v1/enc") as BufferSource },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: hkdfSalt as BufferSource, info: encoder.encode("toucan-secret/v1/mac") as BufferSource },
      hkdfKey,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    ),
  ]);

  return { encKey, macKey };
};

const deriveKeys = async (passphrase: string, salt: Uint8Array, iterations: number): Promise<DerivedKeys> => {
  const passphraseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase) as BufferSource, "PBKDF2", false, ["deriveBits"]);

  const ikm = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passphraseKey,
    256,
  );

  // PBKDF2 already applied the salt, so the HKDF stage adds none of its own.
  return splitKeys(ikm, new Uint8Array(0));
};

export interface EncryptOptions {
  // Overridable so tests can run at a cost that does not dominate the suite. Never
  // lower it in application code.
  iterations?: number;
}

export const encryptSecret = async (plaintext: string, passphrase: string, options: EncryptOptions = {}): Promise<SecretEnvelope> => {
  const iterations = options.iterations ?? SECRET_DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const aad = canonicalAad(SECRET_KDF_PBKDF2_SHA256, iterations, SECRET_CIPHER_AES_256_GCM);

  const { encKey, macKey } = await deriveKeys(passphrase, salt, iterations);

  const verifier = await crypto.subtle.sign("HMAC", macKey, aad as BufferSource);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource },
    encKey,
    encoder.encode(plaintext) as BufferSource,
  );

  return {
    kdf: SECRET_KDF_PBKDF2_SHA256,
    kdfIterations: iterations,
    cipher: SECRET_CIPHER_AES_256_GCM,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    verifier: toBase64(new Uint8Array(verifier)),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
};

interface ParsedEnvelope {
  iterations: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  verifier: Uint8Array;
  ciphertext: Uint8Array;
  aad: Uint8Array;
}

// Validating shape and parameters up front is what makes the three error classes
// meaningful: by the time we reach the verifier, the only remaining explanations
// are a wrong passphrase or altered ciphertext.
const parseEnvelope = (envelope: SecretEnvelope): ParsedEnvelope => {
  if (envelope.kdf !== SECRET_KDF_PBKDF2_SHA256) {
    throw new SecretFormatError(`unsupported kdf: ${envelope.kdf}`);
  }
  if (envelope.cipher !== SECRET_CIPHER_AES_256_GCM) {
    throw new SecretFormatError(`unsupported cipher: ${envelope.cipher}`);
  }
  if (!Number.isInteger(envelope.kdfIterations) || envelope.kdfIterations < MIN_ITERATIONS || envelope.kdfIterations > MAX_ITERATIONS) {
    throw new SecretFormatError(`kdf iterations out of range: ${envelope.kdfIterations}`);
  }

  const salt = fromBase64(envelope.salt, "salt");
  const nonce = fromBase64(envelope.nonce, "nonce");
  const verifier = fromBase64(envelope.verifier, "verifier");
  const ciphertext = fromBase64(envelope.ciphertext, "ciphertext");

  if (salt.length !== SALT_BYTES) {
    throw new SecretFormatError(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new SecretFormatError(`nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }
  if (verifier.length !== VERIFIER_BYTES) {
    throw new SecretFormatError(`verifier must be ${VERIFIER_BYTES} bytes, got ${verifier.length}`);
  }
  if (ciphertext.length < MIN_CIPHERTEXT_BYTES) {
    throw new SecretFormatError("ciphertext is shorter than the authentication tag");
  }

  return {
    iterations: envelope.kdfIterations,
    salt,
    nonce,
    verifier,
    ciphertext,
    aad: canonicalAad(envelope.kdf, envelope.kdfIterations, envelope.cipher),
  };
};

export const decryptSecret = async (envelope: SecretEnvelope, passphrase: string): Promise<string> => {
  const parsed = parseEnvelope(envelope);
  const { encKey, macKey } = await deriveKeys(passphrase, parsed.salt, parsed.iterations);

  // Check the passphrase first. crypto.subtle.verify compares in constant time.
  const passphraseOk = await crypto.subtle.verify("HMAC", macKey, parsed.verifier as BufferSource, parsed.aad as BufferSource);
  if (!passphraseOk) {
    throw new SecretPassphraseError();
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: parsed.nonce as BufferSource, additionalData: parsed.aad as BufferSource },
      encKey,
      parsed.ciphertext as BufferSource,
    );
  } catch {
    // The passphrase already verified, so this can only be altered stored bytes.
    throw new SecretIntegrityError();
  }

  return decoder.decode(plaintext);
};

// ---- master-v1 ------------------------------------------------------------

/**
 * The unwrapped master key, as raw bytes.
 *
 * Deliberately not a non-extractable CryptoKey: changing the passphrase has to
 * re-wrap these exact bytes, which an unextractable key would make impossible.
 * Nothing is lost by it — the plaintext this key protects is already sitting in
 * the same JS heap the moment a block is open, which the design notes call out as
 * the ceiling of doing end-to-end encryption inside a browser tab.
 */
export type MasterKey = Uint8Array;

export const isMasterEnvelope = (envelope: SecretEnvelope): boolean => envelope.kdf === SECRET_KDF_MASTER_V1;

export const generateMasterKey = (): MasterKey => crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));

// Unlike the legacy aad, this binds the per-block salt. It can, because master-v1
// has no existing records to stay compatible with — and doing so makes each
// block's verifier distinct instead of identical across every block sharing a
// master key.
const masterAad = (salt: Uint8Array): Uint8Array => {
  return encoder.encode(`toucan-secret/v1\nkdf:${SECRET_KDF_MASTER_V1}\ncipher:${SECRET_CIPHER_AES_256_GCM}\nsalt:${toBase64(salt)}\n`);
};

/**
 * wrapMasterKey seals the master key under a passphrase.
 *
 * The wrapped form is an ordinary "pbkdf2-sha256" envelope whose plaintext is the
 * base64 master key, which means the passphrase layer inherits the legacy suite's
 * verifier — and with it the ability to tell "wrong passphrase" apart from "the
 * stored wrapper is damaged", the one distinction a user cannot afford to guess at
 * when their entire set of secrets hangs on it.
 */
export const wrapMasterKey = async (masterKey: MasterKey, passphrase: string, options: EncryptOptions = {}): Promise<SecretEnvelope> => {
  return encryptSecret(toBase64(masterKey), passphrase, { iterations: options.iterations ?? SECRET_MASTER_ITERATIONS });
};

export const unwrapMasterKey = async (envelope: SecretEnvelope, passphrase: string): Promise<MasterKey> => {
  const encoded = await decryptSecret(envelope, passphrase);
  const raw = fromBase64(encoded, "master key");
  if (raw.length !== MASTER_KEY_BYTES) {
    throw new SecretFormatError(`master key must be ${MASTER_KEY_BYTES} bytes, got ${raw.length}`);
  }
  return raw;
};

export const encryptWithMasterKey = async (plaintext: string, masterKey: MasterKey): Promise<SecretEnvelope> => {
  const salt = crypto.getRandomValues(new Uint8Array(MASTER_SALT_BYTES));
  const aad = masterAad(salt);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const { encKey, macKey } = await splitKeys(masterKey as BufferSource, salt);

  const verifier = await crypto.subtle.sign("HMAC", macKey, aad as BufferSource);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource },
    encKey,
    encoder.encode(plaintext) as BufferSource,
  );

  return {
    kdf: SECRET_KDF_MASTER_V1,
    // Not applicable to this suite: no passphrase stretching happens here. Kept in
    // the envelope because the field is required by the wire format, and pinned to
    // zero so a nonzero value reads as a malformed record rather than a hint that
    // some stretching took place.
    kdfIterations: 0,
    cipher: SECRET_CIPHER_AES_256_GCM,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    verifier: toBase64(new Uint8Array(verifier)),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
};

export const decryptWithMasterKey = async (envelope: SecretEnvelope, masterKey: MasterKey): Promise<string> => {
  if (envelope.kdf !== SECRET_KDF_MASTER_V1) {
    throw new SecretFormatError(`unsupported kdf: ${envelope.kdf}`);
  }
  if (envelope.cipher !== SECRET_CIPHER_AES_256_GCM) {
    throw new SecretFormatError(`unsupported cipher: ${envelope.cipher}`);
  }
  if (envelope.kdfIterations !== 0) {
    throw new SecretFormatError(`master envelope must not carry kdf iterations: ${envelope.kdfIterations}`);
  }

  const salt = fromBase64(envelope.salt, "salt");
  const nonce = fromBase64(envelope.nonce, "nonce");
  const verifier = fromBase64(envelope.verifier, "verifier");
  const ciphertext = fromBase64(envelope.ciphertext, "ciphertext");

  if (salt.length !== MASTER_SALT_BYTES) {
    throw new SecretFormatError(`salt must be ${MASTER_SALT_BYTES} bytes, got ${salt.length}`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new SecretFormatError(`nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }
  if (verifier.length !== VERIFIER_BYTES) {
    throw new SecretFormatError(`verifier must be ${VERIFIER_BYTES} bytes, got ${verifier.length}`);
  }
  if (ciphertext.length < MIN_CIPHERTEXT_BYTES) {
    throw new SecretFormatError("ciphertext is shorter than the authentication tag");
  }

  const aad = masterAad(salt);
  const { encKey, macKey } = await splitKeys(masterKey as BufferSource, salt);

  // A mismatch here means this block was written under a different master key —
  // the user reset their passphrase and got a fresh one, say. Reported as a
  // passphrase error because the remedy is the same: the right key is elsewhere.
  const keyOk = await crypto.subtle.verify("HMAC", macKey, verifier as BufferSource, aad as BufferSource);
  if (!keyOk) {
    throw new SecretPassphraseError();
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource },
      encKey,
      ciphertext as BufferSource,
    );
  } catch {
    throw new SecretIntegrityError();
  }

  return decoder.decode(plaintext);
};

// ---- attachment vault -------------------------------------------------------
//
// The locked-attachment vault (see the design doc's part B) reuses this same
// master key rather than a second passphrase. The server needs a way to check
// proof of possession without ever seeing the key or a passphrase, so the
// client derives one fixed, non-secret-reversible value from it and the server
// stores that value (`unlock_verifier`) to compare against on every unlock.
//
// This MUST stay a distinct HMAC domain from the "pbkdf2-sha256"/"master-v1"
// suites' own `verifier` field above — that one is a client-side integrity
// check the server never inspects; this one the server both stores and
// compares. Reusing either the key or the label between them would let a value
// meant for one purpose be replayed as proof for the other.
const VAULT_UNLOCK_PROOF_INFO = "toucan-attach/unlock/v1";

/**
 * Derives the proof sent to AttachmentService.UnlockVault, and the same value
 * the client uploads as `unlock_verifier` so the server has something to
 * compare it against later. Deterministic in the master key alone, so it is
 * identical across tabs/devices without needing its own round trip to agree
 * on a salt.
 */
export const computeVaultUnlockProof = async (masterKey: MasterKey): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", masterKey as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(VAULT_UNLOCK_PROOF_INFO) as BufferSource);
  return toBase64(new Uint8Array(signature));
};
