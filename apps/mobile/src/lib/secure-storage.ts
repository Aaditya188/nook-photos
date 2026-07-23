/**
 * KeyValueStore backed by expo-secure-store (Keychain / Keystore). Used for the
 * bearer token and small config. SecureStore keys must match [A-Za-z0-9._-], so
 * we map the dotted core keys to underscore keys.
 */
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from '@nook/core';

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export const secureStorage: KeyValueStore = {
  async getItem(key) {
    return SecureStore.getItemAsync(safeKey(key));
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(safeKey(key), value);
  },
  async removeItem(key) {
    await SecureStore.deleteItemAsync(safeKey(key));
  },
};
