// The master passphrase workflow, in one place: is one configured, unlock it for
// the session, set one, change it, start over.
//
// Everything cryptographic happens here and in secret-crypto.ts. The passphrase
// arrives as an argument, is used, and is never stored — not in state, not in a
// ref, not in the query cache. Only the unwrapped master key survives the call,
// and only inside secret-session.ts.

import { create } from "@bufbuild/protobuf";
import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { UserSettingSchema } from "@/types/proto/api/v1/user_service_pb";
import {
  generateMasterKey,
  type MasterKey,
  type SecretEnvelope,
  SecretFormatError,
  unwrapMasterKey,
  wrapMasterKey,
} from "@/utils/secret-crypto";
import { lockSecretSession, secretSessionStore, unlockSecretSession } from "@/utils/secret-session";
import { useUpdateUserSetting, useUserSettings } from "./useUserQueries";

const SECRET_KEY_SETTING_SUFFIX = "/settings/SECRET_KEY";

// The wrapped key travels as a user setting rather than a SecretEnvelope, so the
// two shapes are converted at this boundary and nowhere else.
const toEnvelope = (setting: {
  kdf: string;
  kdfIterations: number;
  cipher: string;
  salt: string;
  nonce: string;
  verifier: string;
  wrappedKey: string;
}): SecretEnvelope => ({
  kdf: setting.kdf,
  kdfIterations: setting.kdfIterations,
  cipher: setting.cipher,
  salt: setting.salt,
  nonce: setting.nonce,
  verifier: setting.verifier,
  ciphertext: setting.wrappedKey,
});

export interface SecretMasterKeyState {
  /** False until the user setting has loaded; the UI must not offer "set one" yet. */
  loading: boolean;
  /** Whether a master passphrase has ever been configured. */
  configured: boolean;
  /** Whether the master key is currently held in memory for this tab. */
  unlocked: boolean;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  /** Creates a brand-new master key. Only valid when nothing is configured. */
  setup: (passphrase: string) => Promise<void>;
  /** Re-wraps the existing master key. Every block stays readable. */
  changePassphrase: (currentPassphrase: string, nextPassphrase: string) => Promise<void>;
  /**
   * Discards the master key and generates a fresh one.
   *
   * This is the forgotten-passphrase path, and it is destructive in a way no
   * amount of UI can undo: the old key is what every existing block was encrypted
   * against, and nothing on the server can reproduce it. Callers must have
   * confirmed the user understands that those blocks become permanently
   * unreadable.
   */
  reset: (passphrase: string) => Promise<void>;
}

export const useSecretMasterKey = (): SecretMasterKeyState => {
  const { currentUser } = useAuth();
  const { data: userSettings, isLoading } = useUserSettings(currentUser?.name);
  const { mutateAsync: updateUserSetting } = useUpdateUserSetting();

  const unlocked = useSyncExternalStore(secretSessionStore.subscribe, secretSessionStore.getSnapshot);

  const settingValue = userSettings?.settings.find((s) => s.name.endsWith(SECRET_KEY_SETTING_SUFFIX))?.value;
  const secretKeySetting = settingValue?.case === "secretKeySetting" ? settingValue.value : undefined;
  // An empty wrapper is the server's way of saying "never configured". Checking
  // the ciphertext specifically, rather than the record's existence, keeps a
  // half-written record from reading as configured.
  const configured = !!secretKeySetting && secretKeySetting.wrappedKey !== "";

  const persist = useCallback(
    async (masterKey: MasterKey, passphrase: string) => {
      if (!currentUser?.name) {
        throw new Error("not signed in");
      }
      const envelope = await wrapMasterKey(masterKey, passphrase);
      await updateUserSetting({
        setting: create(UserSettingSchema, {
          name: `${currentUser.name}${SECRET_KEY_SETTING_SUFFIX}`,
          value: {
            case: "secretKeySetting",
            value: {
              kdf: envelope.kdf,
              kdfIterations: envelope.kdfIterations,
              cipher: envelope.cipher,
              salt: envelope.salt,
              nonce: envelope.nonce,
              verifier: envelope.verifier,
              wrappedKey: envelope.ciphertext,
            },
          },
        }),
        // The wrapper is replaced whole. A field mask that let one field through
        // would produce a record no passphrase can open.
        updateMask: ["kdf", "kdf_iterations", "cipher", "salt", "nonce", "verifier", "wrapped_key"],
      });
    },
    [currentUser?.name, updateUserSetting],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!secretKeySetting || secretKeySetting.wrappedKey === "") {
        throw new SecretFormatError("no master key configured");
      }
      const masterKey = await unwrapMasterKey(toEnvelope(secretKeySetting), passphrase);
      unlockSecretSession(masterKey);
    },
    [secretKeySetting],
  );

  const setup = useCallback(
    async (passphrase: string) => {
      const masterKey = generateMasterKey();
      await persist(masterKey, passphrase);
      // Unlock only after the wrapper is safely stored. Unlocking first would leave
      // a tab happily encrypting blocks against a key that no passphrase can ever
      // recover, and the user would not find out until their next session.
      unlockSecretSession(masterKey);
    },
    [persist],
  );

  const changePassphrase = useCallback(
    async (currentPassphrase: string, nextPassphrase: string) => {
      if (!secretKeySetting || secretKeySetting.wrappedKey === "") {
        throw new SecretFormatError("no master key configured");
      }
      // Unwrap with the old passphrase first: it both proves the user knows it and
      // yields the key to re-wrap. No block is touched, which is the entire point
      // of the master-key indirection.
      const masterKey = await unwrapMasterKey(toEnvelope(secretKeySetting), currentPassphrase);
      await persist(masterKey, nextPassphrase);
      unlockSecretSession(masterKey);
    },
    [secretKeySetting, persist],
  );

  const reset = useCallback(
    async (passphrase: string) => {
      const masterKey = generateMasterKey();
      await persist(masterKey, passphrase);
      unlockSecretSession(masterKey);
    },
    [persist],
  );

  return {
    loading: isLoading,
    configured,
    unlocked,
    unlock,
    lock: lockSecretSession,
    setup,
    changePassphrase,
    reset,
  };
};
