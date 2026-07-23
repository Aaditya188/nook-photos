/**
 * Login rate-limiting: the public domain must not allow unlimited password
 * guessing. Sliding-window counters per client IP and per target username;
 * exceeding either locks that key out for LOCK_MS. In-memory (the gateway is a
 * single process); counters prune themselves.
 */

const WINDOW_MS = 10 * 60 * 1000; // failures counted within 10 minutes
const LOCK_MS = 15 * 60 * 1000; // lockout duration
const MAX_PER_IP = 15; // an IP may fail across accounts this many times
const MAX_PER_USER = 8; // one account may be failed against this many times

interface Rec {
  failures: number[];
  lockedUntil: number;
}

const byKey = new Map<string, Rec>();

function rec(key: string): Rec {
  let r = byKey.get(key);
  if (!r) {
    r = { failures: [], lockedUntil: 0 };
    byKey.set(key, r);
  }
  return r;
}

function prune(r: Rec, now: number) {
  r.failures = r.failures.filter((t) => now - t < WINDOW_MS);
}

/** Seconds until the given login keys are allowed again; 0 = allowed. */
export function loginBlockedFor(ip: string, username: string | null): number {
  const now = Date.now();
  let until = 0;
  for (const key of [`ip:${ip}`, username ? `user:${username.toLowerCase()}` : null]) {
    if (!key) continue;
    const r = byKey.get(key);
    if (r && r.lockedUntil > now) until = Math.max(until, r.lockedUntil);
  }
  return until ? Math.ceil((until - now) / 1000) : 0;
}

/** Record a failed login; may start a lockout. */
export function recordLoginFailure(ip: string, username: string | null) {
  const now = Date.now();
  const targets: Array<[string, number]> = [[`ip:${ip}`, MAX_PER_IP]];
  if (username) targets.push([`user:${username.toLowerCase()}`, MAX_PER_USER]);
  for (const [key, max] of targets) {
    const r = rec(key);
    prune(r, now);
    r.failures.push(now);
    if (r.failures.length >= max) {
      r.lockedUntil = now + LOCK_MS;
      r.failures = [];
    }
  }
  // Opportunistic global prune so the map can't grow unbounded.
  if (byKey.size > 10_000) {
    for (const [k, r] of byKey) {
      prune(r, now);
      if (r.failures.length === 0 && r.lockedUntil <= now) byKey.delete(k);
    }
  }
}

/** A successful login clears that user's counter (not the IP's). */
export function recordLoginSuccess(username: string | null) {
  if (username) byKey.delete(`user:${username.toLowerCase()}`);
}
