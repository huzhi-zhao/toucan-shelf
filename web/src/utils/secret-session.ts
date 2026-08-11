// The unlocked `toucan-secret` master key, for as long as the tab lives.
//
// This module is the only place the master key exists after unwrapping, and it
// exists ONLY in this module's closure. It is deliberately never written to
// localStorage or sessionStorage: either one would turn a single XSS into
// permanent theft of every secret the user owns, whereas a key that lives in a
// closure dies with the tab and cannot be read back by a later page load.
//
// The visible consequence is that a reload asks for the master passphrase again.
// That is the intended trade, not an oversight.

import type { MasterKey } from "./secret-crypto";

// How long an idle session stays unlocked. Every decryption pushes the deadline
// back, so this is "walked away from the desk", not "has been reading for a while".
// Kept in sync with the server's VaultTokenDuration (server/auth/token.go) — the
// attachment vault piggybacks on this timer rather than keeping its own.
const IDLE_LOCK_MS = 3 * 60 * 1000;

let masterKey: MasterKey | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

// useSyncExternalStore compares snapshots by identity, so the snapshot has to be a
// stable primitive rather than a fresh object each call.
let snapshot = false;

const emit = () => {
  const next = masterKey !== null;
  if (next !== snapshot) {
    snapshot = next;
  }
  for (const listener of listeners) {
    listener();
  }
};

const clearIdleTimer = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const armIdleTimer = () => {
  clearIdleTimer();
  idleTimer = setTimeout(() => lockSecretSession(), IDLE_LOCK_MS);
};

/**
 * Hands the unwrapped master key to the session.
 *
 * Callers must not retain their own reference: once here, `lockSecretSession` is
 * the single point that decides the key is gone, and a stray copy elsewhere would
 * keep working after the user thinks they locked up.
 */
export const unlockSecretSession = (key: MasterKey): void => {
  masterKey = key;
  armIdleTimer();
  emit();
};

/**
 * Returns the master key, or null when locked.
 *
 * Reading counts as activity: a user working through a page of secrets should not
 * be locked out mid-task.
 */
export const getSecretMasterKey = (): MasterKey | null => {
  if (masterKey !== null) {
    armIdleTimer();
  }
  return masterKey;
};

export const isSecretSessionUnlocked = (): boolean => masterKey !== null;

export const lockSecretSession = (): void => {
  if (masterKey !== null) {
    // Overwrite before dropping the reference. This is not a guarantee — the
    // engine may have copied the buffer during any of the WebCrypto calls, and
    // those copies are unreachable — but it costs nothing and removes the one
    // copy we can actually name.
    masterKey.fill(0);
  }
  masterKey = null;
  clearIdleTimer();
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => snapshot;

export const secretSessionStore = { subscribe, getSnapshot };
