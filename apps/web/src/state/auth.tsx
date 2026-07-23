/**
 * Auth: token + user hydrated from localStorage (same keys as the vanilla
 * dashboard, so existing sessions carry over). `token` non-null is the single
 * source of truth for "signed in". Any 401 anywhere funnels into signOutLocal.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NookClient, type User } from '@nook/core';
import { configureBlobCache, flushBlobCache } from '../lib/blobCache';

function readStoredUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('nookUser') || 'null');
  } catch {
    return null;
  }
}

export interface AuthState {
  token: string | null;
  user: User | null;
  client: NookClient;
  /** ?token= URL for elements that can't send an Authorization header. */
  mediaUrl: (path: string | null | undefined) => string;
  startSession: (token: string, user: User | null) => void;
  setUser: (user: User) => void;
  signOut: () => void;
  /** Drop the local session (used on 401). */
  signOutLocal: () => void;
  /** Hidden/Recently Deleted lock, per session. */
  privateUnlocked: boolean;
  setPrivateUnlocked: (v: boolean) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nookToken'));
  const [user, setUserState] = useState<User | null>(readStoredUser);
  const [privateUnlocked, setPrivateUnlocked] = useState(false);

  const client = useMemo(() => {
    const c = new NookClient({ baseUrl: window.location.origin, token });
    return c;
  }, [token]);

  const tokenRef = useRef(token);
  tokenRef.current = token;

  const signOutLocal = useCallback(() => {
    if (!tokenRef.current) return;
    localStorage.removeItem('nookToken');
    localStorage.removeItem('nookUser');
    flushBlobCache();
    setToken(null);
    setUserState(null);
    setPrivateUnlocked(false);
  }, []);

  const signOut = useCallback(() => {
    const tok = tokenRef.current;
    signOutLocal();
    if (tok) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok },
      }).catch(() => {});
    }
  }, [signOutLocal]);

  const startSession = useCallback((tok: string, u: User | null) => {
    localStorage.setItem('nookToken', tok);
    if (u) localStorage.setItem('nookUser', JSON.stringify(u));
    flushBlobCache();
    setPrivateUnlocked(false);
    setUserState(u);
    setToken(tok);
  }, []);

  const setUser = useCallback((u: User) => {
    localStorage.setItem('nookUser', JSON.stringify(u));
    setUserState(u);
  }, []);

  const mediaUrl = useCallback(
    (path: string | null | undefined) => {
      if (!path) return '';
      const t = tokenRef.current;
      if (!t) return path;
      return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
    },
    [],
  );

  // Wire the shared blob cache to this session.
  useEffect(() => {
    configureBlobCache(
      (): Record<string, string> =>
        tokenRef.current ? { Authorization: 'Bearer ' + tokenRef.current } : {},
      signOutLocal,
    );
  }, [signOutLocal]);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      client,
      mediaUrl,
      startSession,
      setUser,
      signOut,
      signOutLocal,
      privateUnlocked,
      setPrivateUnlocked,
    }),
    [token, user, client, mediaUrl, startSession, setUser, signOut, signOutLocal, privateUnlocked],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
