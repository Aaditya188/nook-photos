/**
 * KeyValueStore for the bearer token and small config.
 *
 * Prefers expo-secure-store (Keychain / Keystore). Some Expo Go builds ship a
 * native ExpoSecureStore module that predates the JS API (SDK 57's JS calls
 * `getValueWithKeyAsync`, which older Go clients don't implement, crashing on
 * launch) — so availability is probed first and every call is guarded, falling
 * back to AsyncStorage when SecureStore can't be used on this runtime.
 * SecureStore keys must match [A-Za-z0-9._-], so dotted core keys are mapped
 * to underscore keys.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@nook/core';

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

let secureOk: boolean | null = null;

async function canUseSecureStore(): Promise<boolean> {
  if (secureOk === null) {
    try {
      secureOk = await SecureStore.isAvailableAsync();
    } catch {
      secureOk = false;
    }
  }
  return secureOk;
}

export const secureStorage: KeyValueStore = {
  async getItem(key) {
    if (await canUseSecureStore()) {
      try {
        return await SecureStore.getItemAsync(safeKey(key));
      } catch {
        /* fall through to AsyncStorage */
      }
    }
    return AsyncStorage.getItem(safeKey(key));
  },
  async setItem(key, value) {
    if (await canUseSecureStore()) {
      try {
        await SecureStore.setItemAsync(safeKey(key), value);
        return;
      } catch {
        /* fall through to AsyncStorage */
      }
    }
    await AsyncStorage.setItem(safeKey(key), value);
  },
  async removeItem(key) {
    if (await canUseSecureStore()) {
      try {
        await SecureStore.deleteItemAsync(safeKey(key));
        return;
      } catch {
        /* fall through to AsyncStorage */
      }
    }
    await AsyncStorage.removeItem(safeKey(key));
  },
};
