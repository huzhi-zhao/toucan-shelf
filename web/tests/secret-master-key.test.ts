import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  decryptWithMasterKey,
  encryptSecret,
  encryptWithMasterKey,
  generateMasterKey,
  isMasterEnvelope,
  SecretFormatError,
  SecretIntegrityError,
  SecretPassphraseError,
  unwrapMasterKey,
  wrapMasterKey,
} from "@/utils/secret-crypto";

// Wrapping runs PBKDF2 at the master cost, which is deliberately expensive. Tests
// pass the floor instead so the suite does not spend seconds proving arithmetic.
const CHEAP = { iterations: 100_000 };

describe("master key wrapping", () => {
  it("round-trips the master key through a passphrase", async () => {
    const masterKey = generateMasterKey();
    const wrapped = await wrapMasterKey(masterKey, "correct horse battery", CHEAP);
    expect(await unwrapMasterKey(wrapped, "correct horse battery")).toEqual(masterKey);
  });

  it("generates a distinct 256-bit key each time", () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });

  // The wrapper is an ordinary pbkdf2 envelope, which is what gives it a verifier —
  // and with it, the ability to say "wrong passphrase" rather than a bare failure.
  it("reports a wrong passphrase distinctly", async () => {
    const wrapped = await wrapMasterKey(generateMasterKey(), "right", CHEAP);
    await expect(unwrapMasterKey(wrapped, "wrong")).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  it("reports a damaged wrapper as corruption, not a bad passphrase", async () => {
    const wrapped = await wrapMasterKey(generateMasterKey(), "right", CHEAP);
    const bytes = atob(wrapped.ciphertext).split("");
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff);
    await expect(unwrapMasterKey({ ...wrapped, ciphertext: btoa(bytes.join("")) }, "right")).rejects.toBeInstanceOf(SecretIntegrityError);
  });

  // A wrapper whose plaintext is not key-shaped means something other than a master
  // key was stored there. Opening it would seed every block with a wrong-length key.
  it("rejects a wrapper holding something that is not a 32-byte key", async () => {
    const bogus = await encryptSecret("not-a-key", "right", CHEAP);
    await expect(unwrapMasterKey(bogus, "right")).rejects.toBeInstanceOf(SecretFormatError);
  });
});

describe("master-v1 block encryption", () => {
  it("round-trips a payload under the master key", async () => {
    const masterKey = generateMasterKey();
    const envelope = await encryptWithMasterKey("MINIO_ROOT_PASSWORD=hunter2", masterKey);
    expect(isMasterEnvelope(envelope)).toBe(true);
    expect(await decryptWithMasterKey(envelope, masterKey)).toBe("MINIO_ROOT_PASSWORD=hunter2");
  });

  it("round-trips empty content", async () => {
    const masterKey = generateMasterKey();
    expect(await decryptWithMasterKey(await encryptWithMasterKey("", masterKey), masterKey)).toBe("");
  });

  // The whole reason this suite is fast: no passphrase stretching happens per block.
  it("carries no iteration count", async () => {
    const envelope = await encryptWithMasterKey("x", generateMasterKey());
    expect(envelope.kdf).toBe("master-v1");
    expect(envelope.kdfIterations).toBe(0);
  });

  // Each block gets its own HKDF salt, so two blocks holding the same text under the
  // same key must not produce the same bytes — nor the same verifier, which would
  // otherwise let an observer group blocks by key.
  it("produces distinct salts, ciphertexts and verifiers for identical payloads", async () => {
    const masterKey = generateMasterKey();
    const a = await encryptWithMasterKey("same", masterKey);
    const b = await encryptWithMasterKey("same", masterKey);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("reports a different master key as a key error", async () => {
    const envelope = await encryptWithMasterKey("secret", generateMasterKey());
    await expect(decryptWithMasterKey(envelope, generateMasterKey())).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  it("reports tampered ciphertext as corruption", async () => {
    const masterKey = generateMasterKey();
    const envelope = await encryptWithMasterKey("secret", masterKey);
    const bytes = atob(envelope.ciphertext).split("");
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff);
    await expect(decryptWithMasterKey({ ...envelope, ciphertext: btoa(bytes.join("")) }, masterKey)).rejects.toBeInstanceOf(
      SecretIntegrityError,
    );
  });

  // The salt is bound into the additional authenticated data, so swapping it is a
  // parameter tamper rather than something that silently derives a different key.
  it("rejects an envelope whose salt has been swapped", async () => {
    const masterKey = generateMasterKey();
    const a = await encryptWithMasterKey("secret", masterKey);
    const b = await encryptWithMasterKey("other", masterKey);
    await expect(decryptWithMasterKey({ ...a, salt: b.salt }, masterKey)).rejects.toBeInstanceOf(SecretPassphraseError);
  });

  // A downgraded record must not be honored: an attacker who could relabel a master
  // envelope as pbkdf2 would otherwise hand the payload to a passphrase guess.
  it("refuses to open a master envelope with the passphrase suite, and vice versa", async () => {
    const masterKey = generateMasterKey();
    const master = await encryptWithMasterKey("secret", masterKey);
    const legacy = await encryptSecret("secret", "passphrase", CHEAP);

    await expect(decryptSecret(master, "passphrase")).rejects.toBeInstanceOf(SecretFormatError);
    await expect(decryptWithMasterKey(legacy, masterKey)).rejects.toBeInstanceOf(SecretFormatError);
    expect(isMasterEnvelope(legacy)).toBe(false);
  });

  it("refuses a master envelope claiming an iteration count", async () => {
    const masterKey = generateMasterKey();
    const envelope = await encryptWithMasterKey("secret", masterKey);
    await expect(decryptWithMasterKey({ ...envelope, kdfIterations: 600_000 }, masterKey)).rejects.toBeInstanceOf(SecretFormatError);
  });
});
