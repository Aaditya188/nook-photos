/**
 * Platform-agnostic persistence interface. The mobile app backs this with
 * expo-secure-store; the web app with localStorage. `core` never imports either.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory fallback (tests / SSR). Not persistent. */
export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
}

export const STORAGE_KEYS = {
  serverUrl: 'nook.serverUrl',
  token: 'nook.token',
  user: 'nook.user',
  settings: 'nook.settings',
  themeMode: 'nook.themeMode',
} as const;
