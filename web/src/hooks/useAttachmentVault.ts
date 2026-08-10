// Frontend side of AttachmentService.UnlockVault/LockVault: turns the master key
// held in secret-session.ts into the HMAC proof the server compares against
// `unlock_verifier`, and tracks the resulting vault cookie's presumed state in
// vault-session.ts (see that file for why there's no independent timer here).

import { useCallback, useSyncExternalStore } from "react";
import { attachmentServiceClient } from "@/connect";
import { computeVaultUnlockProof } from "@/utils/secret-crypto";
import { getSecretMasterKey } from "@/utils/secret-session";
import { isVaultUnlocked, setVaultUnlocked, vaultSessionStore } from "@/utils/vault-session";

export class VaultLockedError extends Error {
  constructor() {
    super("the master passphrase must be unlocked before the attachment vault can be opened");
    this.name = "VaultLockedError";
  }
}

export interface AttachmentVaultState {
  /** Optimistic client-side read of whether the vault cookie is presumed set. */
  unlocked: boolean;
  /**
   * Derives this session's proof from the already-unlocked master key and calls
   * UnlockVault. Throws VaultLockedError if the master key itself isn't unlocked
   * yet — callers should unlock that first (useSecretMasterKey) rather than
   * prompt for a second passphrase.
   */
  unlock: () => Promise<void>;
  lock: () => Promise<void>;
}

export const useAttachmentVault = (): AttachmentVaultState => {
  const unlocked = useSyncExternalStore(vaultSessionStore.subscribe, vaultSessionStore.getSnapshot, () => isVaultUnlocked());

  const unlock = useCallback(async () => {
    const masterKey = getSecretMasterKey();
    if (!masterKey) {
      throw new VaultLockedError();
    }
    const proof = await computeVaultUnlockProof(masterKey);
    await attachmentServiceClient.unlockVault({ proof });
    setVaultUnlocked(true);
  }, []);

  const lock = useCallback(async () => {
    await attachmentServiceClient.lockVault({});
    setVaultUnlocked(false);
  }, []);

  return { unlocked, unlock, lock };
};
