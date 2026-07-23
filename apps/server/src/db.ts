/**
 * Read-only view of the origin server's db.json, cached and refreshed on mtime
 * change (the origin owns writes). Used only to authorize media requests:
 * token -> userId, and photo ownership.
 */
import fs from 'node:fs';
import { DB_PATH } from './config.js';

interface TokenRec {
  userId: string;
  createdAt: string;
}
interface PhotoRec {
  id: string;
  userId: string;
  filename?: string;
  mediaType?: 'photo' | 'video';
  deletedAt?: string | null;
}
interface Db {
  tokens: Record<string, TokenRec>;
  photos: PhotoRec[];
}

let cache: { mtimeMs: number; db: Db; photoById: Map<string, PhotoRec> } | null = null;

function load(): typeof cache {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(DB_PATH);
  } catch {
    return null;
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const db: Db = {
      tokens: raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {},
      photos: Array.isArray(raw.photos) ? raw.photos : [],
    };
    cache = { mtimeMs: stat.mtimeMs, db, photoById: new Map(db.photos.map((p) => [p.id, p])) };
    return cache;
  } catch {
    return cache; // keep last good copy on a torn read
  }
}

export function userIdForToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const c = load();
  return c?.db.tokens[token]?.userId ?? null;
}

export function photoById(id: string): PhotoRec | null {
  return load()?.photoById.get(id) ?? null;
}

/** Authorize a media request: returns the photo if the token's user owns it. */
export function authorizePhoto(token: string | null, id: string): PhotoRec | null {
  const userId = userIdForToken(token);
  if (!userId) return null;
  const photo = photoById(id);
  if (!photo || photo.userId !== userId) return null;
  return photo;
}
