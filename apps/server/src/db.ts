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
  createdAt?: string;
  width?: number;
  height?: number;
  duration?: number | null;
  uploadState?: string;
}
export interface AlbumRec {
  id: string;
  userId: string;
  name: string;
  photoIds: string[];
  coverPhotoId?: string | null;
  grants?: { userId: string; level?: string; expiresAt?: number | null }[];
}
interface Db {
  tokens: Record<string, TokenRec>;
  photos: PhotoRec[];
  albums: AlbumRec[];
}

let cache: {
  mtimeMs: number;
  db: Db;
  photoById: Map<string, PhotoRec>;
  albumById: Map<string, AlbumRec>;
} | null = null;

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
      albums: Array.isArray(raw.albums) ? raw.albums : [],
    };
    cache = {
      mtimeMs: stat.mtimeMs,
      db,
      photoById: new Map(db.photos.map((p) => [p.id, p])),
      albumById: new Map(db.albums.map((a) => [a.id, a])),
    };
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

/** True if a non-expired album grant lets this user see this photo. */
function photoSharedToUser(userId: string, photoId: string): boolean {
  const c = load();
  if (!c) return false;
  const now = Date.now();
  for (const a of c.db.albums) {
    if (a.userId === userId) continue;
    const g = (a.grants ?? []).find((x) => x.userId === userId && (!x.expiresAt || x.expiresAt > now));
    if (g && a.photoIds.includes(photoId)) return true;
  }
  return false;
}

/**
 * Authorize a media request: returns the photo if the token's user owns it, or
 * if it's in an album shared with them (read access for shared albums).
 */
export function authorizePhoto(token: string | null, id: string): PhotoRec | null {
  const userId = userIdForToken(token);
  if (!userId) return null;
  const photo = photoById(id);
  if (!photo) return null;
  if (photo.userId === userId || photoSharedToUser(userId, id)) return photo;
  return null;
}

export function albumById(id: string): AlbumRec | null {
  return load()?.albumById.get(id) ?? null;
}

/** Returns the album if the token's user owns it. */
export function authorizeAlbum(token: string | null, id: string): AlbumRec | null {
  const userId = userIdForToken(token);
  if (!userId) return null;
  const album = albumById(id);
  if (!album || album.userId !== userId) return null;
  return album;
}
