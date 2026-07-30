// Client-side encryption for `toucan-secret` blocks.
//
// Everything here runs in the browser. The passphrase never leaves this module's
// call stack, and the server only ever receives a SecretEnvelope. There is
// deliberately no server-side counterpart to this file.
//
// v1 suite (all WebCrypto, no third-party dependency):
//
//   ikm      = PBKDF2-SHA256(passphrase, salt, iterations, 256 bit)
//   encKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/enc") -> AES-256-GCM
//   macKey   = HKDF-SHA256(ikm, info="toucan-secret/v1/mac") -> HMAC-SHA256
//   verifier = HMAC(macKey, aad)
//   payload  = AES-256-GCM(encKey, nonce, plaintext, additionalData = aad)
//
// The algorithm names and iteration count are stored per record rather than
// assumed, so a future suite can be added without migrating existing envelopes.

export const SECRET_KDF_PBKDF2_SHA256 = "pbkdf2-sha256";
export const SECRET_CIPHER_AES_256_GCM = "aes-256-gcm";

// OWASP's current floor for PBKDF2-SHA256. This is the only thing standing between
// a leaked database and the plaintext, so it is not a performance knob to trim.
export const SECRET_DEFAULT_ITERATIONS = 600_000;

// Anything below this is treated as a corrupted or downgraded envelope rather than
// something to honor: an attacker who could rewrite `kdf_iterations` down to 1
// would otherwise make brute force free.
const MIN_ITERATIONS = 100_000;
// Guards against a hostile record wedging the tab in an unbounded derivation.
const MAX_ITERATIONS = 10_000_000;

const SALT_BYTES = 16;
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

const deriveKeys = async (passphrase: string, salt: Uint8Array, iterations: number): Promise<DerivedKeys> => {
  const passphraseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase) as BufferSource, "PBKDF2", false, ["deriveBits"]);

  const ikm = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passphraseKey,
    256,
  );

  // Split the single derived secret into two independent keys, so the value that
  // proves the passphrase is never the value that decrypts the payload.
  const hkdfKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  const hkdfSalt = new Uint8Array(0);

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
