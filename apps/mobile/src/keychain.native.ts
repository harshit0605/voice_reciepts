import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";

// iOS keeps the keychain shut while the phone is locked, so a read made while the app runs in the
// background (launched or resumed on a locked phone) fails with "User interaction is not allowed"
// (errSecInteractionNotAllowed). That is not a fault to show staff: wait until the app is in front
// again (the phone is then unlocked) and read once more.
const LOCKED =
  /User interaction is not allowed|-25308|errSecInteractionNotAllowed/i;
export const isKeychainLocked = (e: unknown) =>
  LOCKED.test(String((e as Error)?.message ?? e));

function untilActive() {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      sub.remove();
      resolve();
    });
  });
}

async function whenUnlocked<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (e) {
      // The app can be "active" for a moment while the phone locks, so give up after a few tries.
      if (!isKeychainLocked(e) || attempt >= 6) throw e;
      await untilActive();
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

// New items stay readable in the background after the first unlock since the phone started.
// Existing items keep the accessibility they were saved with (an update changes only the value).
const writeOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** SecureStore with keychain reads and writes that wait out a locked phone instead of failing. */
export const keychain = {
  ...SecureStore,
  getItemAsync: (key: string, options?: SecureStore.SecureStoreOptions) =>
    whenUnlocked(() => SecureStore.getItemAsync(key, options)),
  setItemAsync: (
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ) =>
    whenUnlocked(() =>
      SecureStore.setItemAsync(key, value, { ...writeOptions, ...options }),
    ),
  deleteItemAsync: (key: string, options?: SecureStore.SecureStoreOptions) =>
    whenUnlocked(() => SecureStore.deleteItemAsync(key, options)),
  setItem: (
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ) => SecureStore.setItem(key, value, { ...writeOptions, ...options }),
};
