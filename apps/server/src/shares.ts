/**
 * Album share links: a random URL token grants read access to one album —
 * optionally expiring, optionally password-protected, optionally allowing
 * original downloads. Viewable with no account. Records persist in
 * DATA_DIR/shares.json; password unlocks issue short-lived in-memory session
 * tokens so the password never rides on media URLs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export interface ShareRec {
  id: string;
  albumId: string;
  userId: string;
  createdAt: number;
  /** null = never expires. */
  expiresAt: number | null;
  /** scrypt hash "salt:hex" or null when the link is open. */
  passwordHash: string | null;
  allowDownload: boolean;
}

const SHARES_PATH = path.join(DATA_DIR, 'shares.json');

const shares = new Map<string, ShareRec>(); // by share id
const byAlbum = new Map<string, string>(); // albumId -> share id

try {
  const raw = JSON.parse(fs.readFileSync(SHARES_PATH, 'utf8')) as Record<string, ShareRec>;
  for (const [id, s] of Object.entries(raw)) {
    if (s && s.albumId) {
      shares.set(id, s);
      byAlbum.set(s.albumId, id);
    }
  }
} catch {
  /* first run */
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const obj: Record<string, ShareRec> = {};
    for (const [id, s] of shares) obj[id] = s;
    const tmp = `${SHARES_PATH}.${process.pid}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(obj));
      await fsp.rename(tmp, SHARES_PATH);
    } catch {
      /* next mutation retries */
    }
  }, 300);
}

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(12).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(stored: string, pw: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

export function createShare(
  albumId: string,
  userId: string,
  opts: { expiresDays?: number | null; password?: string | null; allowDownload?: boolean },
): ShareRec {
  // One live link per album: recreating replaces (and so revokes) the old URL.
  const existing = byAlbum.get(albumId);
  if (existing) shares.delete(existing);
  const rec: ShareRec = {
    id: crypto.randomBytes(12).toString('base64url'),
    albumId,
    userId,
    createdAt: Date.now(),
    expiresAt:
      opts.expiresDays && opts.expiresDays > 0
        ? Date.now() + opts.expiresDays * 86400_000
        : null,
    passwordHash: opts.password ? hashPassword(opts.password) : null,
    allowDownload: !!opts.allowDownload,
  };
  shares.set(rec.id, rec);
  byAlbum.set(albumId, rec.id);
  persist();
  return rec;
}

export function shareForAlbum(albumId: string): ShareRec | null {
  const id = byAlbum.get(albumId);
  return id ? (shares.get(id) ?? null) : null;
}

export function getShare(sid: string): ShareRec | null {
  const s = shares.get(sid);
  if (!s) return null;
  if (s.expiresAt && Date.now() > s.expiresAt) return null; // expired
  return s;
}

export function revokeShare(albumId: string): boolean {
  const id = byAlbum.get(albumId);
  if (!id) return false;
  shares.delete(id);
  byAlbum.delete(albumId);
  persist();
  return true;
}

// ---- password unlock sessions (in-memory; die with the process) ----

const sessions = new Map<string, { sid: string; expires: number }>();

export function unlockShare(sid: string, password: string): string | null {
  const s = getShare(sid);
  if (!s || !s.passwordHash) return null;
  if (!checkPassword(s.passwordHash, password)) return null;
  const st = crypto.randomBytes(16).toString('base64url');
  sessions.set(st, { sid, expires: Date.now() + 24 * 3600_000 });
  if (sessions.size > 5000) {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  }
  return st;
}

/** True when this request may read the share's content. */
export function shareUnlocked(s: ShareRec, st: string | null | undefined): boolean {
  if (!s.passwordHash) return true;
  if (!st) return false;
  const sess = sessions.get(st);
  return !!sess && sess.sid === s.id && sess.expires > Date.now();
}
