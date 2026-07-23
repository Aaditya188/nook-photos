/**
 * Auth + server-connection store. Holds the configured server URL, bearer token,
 * and current user; persists them to secure storage; and exposes login / setup /
 * logout. The React tree derives a NookClient from `serverUrl` + `token`.
 */
import { create } from 'zustand';
import { NookClient, STORAGE_KEYS, type User } from '@nook/core';
import { secureStorage } from '@/lib/secure-storage';

export type AuthStatus = 'loading' | 'unauthed' | 'authed';

interface AuthState {
  status: AuthStatus;
  serverUrl: string | null;
  token: string | null;
  user: User | null;
  hydrate: () => Promise<void>;
  /** Probe a candidate server; returns ping info or throws. */
  testConnection: (url: string) => Promise<{ ok: boolean; setupRequired: boolean; name?: string }>;
  setServerUrl: (url: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (input: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  serverUrl: null,
  token: null,
  user: null,

  async hydrate() {
    const [serverUrl, token, userRaw] = await Promise.all([
      secureStorage.getItem(STORAGE_KEYS.serverUrl),
      secureStorage.getItem(STORAGE_KEYS.token),
      secureStorage.getItem(STORAGE_KEYS.user),
    ]);
    const user = userRaw ? (JSON.parse(userRaw) as User) : null;
    set({
      serverUrl: serverUrl ?? null,
      token: token ?? null,
      user,
      status: token && serverUrl ? 'authed' : 'unauthed',
    });
  },

  async testConnection(url) {
    const client = new NookClient({ baseUrl: url });
    const res = await client.ping();
    return { ok: res.ok, setupRequired: res.setupRequired, server: res.server } as any;
  },

  async setServerUrl(url) {
    const normalized = new NookClient({ baseUrl: url }).baseUrl;
    await secureStorage.setItem(STORAGE_KEYS.serverUrl, normalized);
    set({ serverUrl: normalized });
  },

  async login(username, password) {
    const serverUrl = get().serverUrl;
    if (!serverUrl) throw new Error('No server configured');
    const client = new NookClient({ baseUrl: serverUrl });
    const { token, user } = await client.login({ username, password });
    await Promise.all([
      secureStorage.setItem(STORAGE_KEYS.token, token),
      secureStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user)),
    ]);
    set({ token, user, status: 'authed' });
  },

  async setup(input) {
    const serverUrl = get().serverUrl;
    if (!serverUrl) throw new Error('No server configured');
    const client = new NookClient({ baseUrl: serverUrl });
    const { token, user } = await client.setup(input);
    await Promise.all([
      secureStorage.setItem(STORAGE_KEYS.token, token),
      secureStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user)),
    ]);
    set({ token, user, status: 'authed' });
  },

  async logout() {
    const { serverUrl, token } = get();
    if (serverUrl && token) {
      try {
        await new NookClient({ baseUrl: serverUrl, token }).logout();
      } catch {
        // best-effort server-side revoke; clear locally regardless
      }
    }
    await Promise.all([
      secureStorage.removeItem(STORAGE_KEYS.token),
      secureStorage.removeItem(STORAGE_KEYS.user),
    ]);
    set({ token: null, user: null, status: 'unauthed' });
  },
}));
