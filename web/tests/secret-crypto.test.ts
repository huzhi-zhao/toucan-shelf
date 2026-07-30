import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  SECRET_DEFAULT_ITERATIONS,
  SecretEnvelope,
  SecretFormatError,
  SecretIntegrityError,
  SecretPassphraseError,
} from "@/utils/secret-crypto";

// PBKDF2 at the production iteration count costs ~half a second per derivation,
// which would dominate this suite. The cost parameter is orthogonal to every
// property under test, so run at the supported floor.
const TEST_ITERATIONS = 100_000;
const encrypt = (plaintext: string, passphrase: string) => encryptSecret(plaintext, passphrase, { iterations: TEST_ITERATIONS });

const flipLastByte = (base64: string): string => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  bytes[bytes.length - 1] ^= 0xff;
  return btoa(String.fromCharCode(...bytes));
};

describe("encryptSecret / decryptSecret", () => {
  it("round-trips", async () => {
    const envelope = await encrypt("AKIA_EXAMPLE / s3cr3t-p@ss", "correct horse battery staple");
    await expect(decryptSecret(envelope, "correct horse battery staple")).resolves.toBe("AKIA_EXAMPLE / s3cr3t-p@ss");
  });

  it("round-trips multi-line and non-ASCII plaintext", async () => {
    const plaintext = "user: 管理员\npass: pä$$w0rd\n\n-----BEGIN-----\nzzz\n-----END-----";
    const envelope = await encrypt(plaintext, "口令");
    await expect(decryptSecret(envelope, "口令")).resolves.toBe(plaintext);
  });

  it("round-trips empty plaintext", async () => {
    const envelope = await encrypt("", "pw");
    await expect(decryptSecret(envelope, "pw")).resolves.toBe("");
  });

  it("produces a different salt, nonce and ciphertext each time", async () => {
    const a = await encrypt("same", "pw");
    const b = await encrypt("same", "pw");
    expect(a.salt).not.toBe(b.salt);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("leaks no plaintext into the envelope", async () => {
    const envelope = await encrypt("needle", "pw");
    expect(JSON.stringify(envelope)).not.toContain("needle");
  });

  it("defaults to the production iteration count", async () => {
    // Not run through the helper: this asserts the default itself.
    const envelope = await encryptSecret("x", "pw");
    expect(envelope.kdfIterations).toBe(SECRET_DEFAULT_ITERATIONS);
    await expect(decryptSecret(envelope, "pw")).resolves.toBe("x");
  });
});

// The three failure classes are the point of the verifier: a user who hit
// corruption must not be left retrying passwords they remember correctly.
describe("decryptSecret failure modes", () => {
  it("reports a wrong passphrase as SecretPassphraseError", async () => {
    const envelope = await encrypt("secret", "right");
    await expect(decryptSecret(envelope, "wrong")).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  it("reports tampered ciphertext as SecretIntegrityError, not a bad passphrase", async () => {
    const envelope = await encrypt("secret", "pw");
    const tampered: SecretEnvelope = { ...envelope, ciphertext: flipLastByte(envelope.ciphertext) };
    await expect(decryptSecret(tampered, "pw")).rejects.toBeInstanceOf(SecretIntegrityError);
  });

  it("reports a tampered nonce as SecretIntegrityError", async () => {
    const envelope = await encrypt("secret", "pw");
    const tampered: SecretEnvelope = { ...envelope, nonce: flipLastByte(envelope.nonce) };
    await expect(decryptSecret(tampered, "pw")).rejects.toBeInstanceOf(SecretIntegrityError);
  });

  // A tampered salt derives different keys, so it surfaces as a passphrase failure.
  // That is honest: with that salt, this passphrase genuinely does not unlock it.
  it("reports a tampered salt as SecretPassphraseError", async () => {
    const envelope = await encrypt("secret", "pw");
    const tampered: SecretEnvelope = { ...envelope, salt: flipLastByte(envelope.salt) };
    await expect(decryptSecret(tampered, "pw")).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  it("rejects a downgraded iteration count instead of honoring it", async () => {
    const envelope = await encrypt("secret", "pw");
    const downgraded: SecretEnvelope = { ...envelope, kdfIterations: 1 };
    await expect(decryptSecret(downgraded, "pw")).rejects.toBeInstanceOf(SecretFormatError);
  });

  it("rejects an absurd iteration count instead of hanging the tab", async () => {
    const envelope = await encrypt("secret", "pw");
    const absurd: SecretEnvelope = { ...envelope, kdfIterations: 1_000_000_000 };
    await expect(decryptSecret(absurd, "pw")).rejects.toBeInstanceOf(SecretFormatError);
  });

  // The AAD binds the algorithm names, so an in-range but altered iteration count
  // fails authentication rather than silently decrypting under other parameters.
  it("rejects an in-range but altered iteration count", async () => {
    const envelope = await encrypt("secret", "pw");
    const altered: SecretEnvelope = { ...envelope, kdfIterations: TEST_ITERATIONS + 1 };
    await expect(decryptSecret(altered, "pw")).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  it.each([
    ["unsupported kdf", { kdf: "argon2id" }],
    ["unsupported cipher", { cipher: "chacha20-poly1305" }],
    ["non-integer iterations", { kdfIterations: 100_000.5 }],
    ["salt that is not base64", { salt: "!!!!" }],
    ["truncated salt", { salt: "AAAA" }],
    ["truncated nonce", { nonce: "AAAA" }],
    ["truncated verifier", { verifier: "AAAA" }],
    ["ciphertext shorter than the tag", { ciphertext: "AAAA" }],
  ])("rejects %s as SecretFormatError", async (_label, patch) => {
    const envelope = await encrypt("secret", "pw");
    await expect(decryptSecret({ ...envelope, ...patch } as SecretEnvelope, "pw")).rejects.toBeInstanceOf(SecretFormatError);
  });
});
