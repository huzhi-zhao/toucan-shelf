// Client-side optimistic flag for "is the attachment vault currently unlocked".
//
// The actual gate is the server's httpOnly vault cookie (server/auth/token.go) —
// this module never sees it and cannot read it back. It only remembers whether
// the last UnlockVault/LockVault call succeeded, so the UI can decide whether to
// offer "download" or "unlock" without probing a locked attachment's URL to find
// out (which would just be a slower way to learn the same 403).
//
// R5 of the design doc requires the vault to ride the same idle timer as the
// secret-block master key rather than keep a second one: this store has no timer
// of its own and instead locks the moment secretSessionStore reports the master
// key gone (idle timeout, explicit lock, or a fresh page load that never unlocked
// it in the first place).

import { secretSessionStore } from "./secret-session";

let unlocked = false;
const listeners = new Set<() => void>();
let snapshot = false;

const emit = () => {
  snapshot = unlocked;
  for (const listener of listeners) {
    listener();
  }
};

export const setVaultUnlocked = (value: boolean): void => {
  if (unlocked === value) {
    return;
  }
  unlocked = value;
  emit();
};

export const isVaultUnlocked = (): boolean => unlocked;

secretSessionStore.subscribe(() => {
  if (!secretSessionStore.getSnapshot() && unlocked) {
    setVaultUnlocked(false);
  }
});

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => snapshot;

export const vaultSessionStore = { subscribe, getSnapshot };
