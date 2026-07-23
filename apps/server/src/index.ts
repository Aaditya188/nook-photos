/**
 * Nook performance gateway.
 *
 * Serves the two heavy media endpoints itself — size-bucketed thumbnails (sharp,
 * disk-cached) and Range-based streaming for originals/video — validated against
 * the origin's db.json auth. Everything else is reverse-proxied to the origin
 * (the proven zero-dependency server.js), so the full API contract is preserved
 * while the laggy parts get fast. Runs alongside the origin; cut over the tunnel
 * only once verified.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import Fastify from 'fastify';
import replyFrom from '@fastify/reply-from';
import fastifyStatic from '@fastify/static';
import { ORIGIN, PORT, ORIGINALS_DIR } from './config.js';
import { authorizePhoto } from './db.js';
import { getSizedThumb, getViewJpeg } from './thumbs.js';
import { loginBlockedFor, recordLoginFailure, recordLoginSuccess } from './ratelimit.js';
import { annotatePhotos, clearEdit, getEdit, sanitizeRecipe, setEdit } from './edits.js';
import { authorizeAlbum, albumById, photoById, userIdForToken } from './db.js';
import {
  createShare,
  getShare,
  revokeShare,
  shareForAlbum,
  shareUnlocked,
  unlockShare,
} from './shares.js';
import { listSnapshots, startSnapshotSchedule, takeSnapshot } from './snapshots.js';

// The web dashboard served at /: the built React app (apps/web/dist) by
// default, the vanilla apps/webui as automatic fallback, or NOOK_WEB_DIST.
const APPS_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const WEB_CANDIDATES = [
  process.env.NOOK_WEB_DIST,
  path.join(APPS_DIR, 'web', 'dist'),
  path.join(APPS_DIR, 'webui'),
].filter((p): p is string => !!p);
const WEB_DIST =
  WEB_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'index.html'))) ??
  path.join(APPS_DIR, 'webui');
const HAS_WEB = fs.existsSync(path.join(WEB_DIST, 'index.html'));

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 1024 * 1024 * 1024, // 1 GB — originals/videos stream through the proxy
});

// Transparent proxy: never buffer/parse bodies ourselves. Hand the raw request
// stream to @fastify/reply-from so uploads (image/heic, video, octet-stream) and
// JSON alike pass straight through to the origin unchanged.
app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

await app.register(replyFrom, { base: ORIGIN, http2: false });

// Serve the built web app (apps/web/dist) at / with SPA fallback.
if (HAS_WEB) {
  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  app.log.info(`serving web app from ${WEB_DIST}`);
}

function bearer(req: { headers: Record<string, unknown>; query?: unknown }): string | null {
  const h = String(req.headers['authorization'] ?? '');
  if (h.startsWith('Bearer ')) return h.slice(7);
  // <img>/<video> can't set an Authorization header, so media may auth via ?token=.
  const q = (req.query as { token?: unknown } | undefined)?.token;
  return typeof q === 'string' && q ? q : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic',
  '.heif': 'image/heif', '.gif': 'image/gif', '.webp': 'image/webp', '.tiff': 'image/tiff',
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
};

function contentTypeFor(filename: string | undefined, mediaType: string | undefined): string {
  const ext = filename ? path.extname(filename).toLowerCase() : '';
  return CONTENT_TYPES[ext] ?? (mediaType === 'video' ? 'video/mp4' : 'application/octet-stream');
}

/**
 * Login with brute-force protection. The body is buffered here (the global
 * passthrough parser hands us a stream) so the username can key the limiter,
 * then the credentials are forwarded to the origin and the outcome recorded.
 */
app.post('/api/login', async (req, reply) => {
  // Fastify's built-in JSON parser handles application/json (object); any
  // other content-type reaches us as the raw stream via the '*' passthrough.
  let raw = '';
  const b: unknown = req.body;
  if (b && typeof (b as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function' && typeof b !== 'string') {
    const chunks: Buffer[] = [];
    for await (const c of b as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    raw = Buffer.concat(chunks).toString('utf8');
  } else if (typeof b === 'string') {
    raw = b;
  } else if (b && typeof b === 'object') {
    raw = JSON.stringify(b);
  }
  let username: string | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.username === 'string') username = parsed.username;
  } catch {
    /* malformed body → origin will reject it */
  }

  const wait = loginBlockedFor(req.ip, username);
  if (wait > 0) {
    const mins = Math.ceil(wait / 60);
    return reply
      .code(429)
      .header('Retry-After', String(wait))
      .send({ error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }

  const res = await fetch(`${ORIGIN}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
  const text = await res.text();
  if (res.ok) recordLoginSuccess(username);
  else if (res.status === 401 || res.status === 403) recordLoginFailure(req.ip, username);
  reply
    .code(res.status)
    .header('Content-Type', res.headers.get('content-type') ?? 'application/json');
  return reply.send(text);
});

/**
 * Non-destructive edits: recipes stored gateway-side; renders pick them up
 * automatically (edit timestamps are part of the cache keys). The library
 * proxy annotates photos with `editedAt` so clients can cache-bust.
 */
app.get<{ Params: { id: string } }>('/api/photos/:id/edit', async (req, reply) => {
  const photo = authorizePhoto(bearer(req), req.params.id);
  if (!photo) return reply.code(404).send({ error: 'not found' });
  const e = getEdit(req.params.id);
  return reply.send(e ? { edited: true, recipe: e.recipe, editedAt: e.editedAt } : { edited: false });
});

app.put<{ Params: { id: string } }>('/api/photos/:id/edit', async (req, reply) => {
  const photo = authorizePhoto(bearer(req), req.params.id);
  if (!photo) return reply.code(404).send({ error: 'not found' });
  if (photo.mediaType === 'video') return reply.code(400).send({ error: 'videos are not editable yet' });
  const recipe = sanitizeRecipe(req.body);
  if (!recipe) {
    // A no-op recipe is a revert.
    clearEdit(req.params.id);
    return reply.send({ edited: false });
  }
  const editedAt = setEdit(req.params.id, recipe);
  return reply.send({ edited: true, recipe, editedAt });
});

app.delete<{ Params: { id: string } }>('/api/photos/:id/edit', async (req, reply) => {
  const photo = authorizePhoto(bearer(req), req.params.id);
  if (!photo) return reply.code(404).send({ error: 'not found' });
  clearEdit(req.params.id);
  return reply.send({ edited: false });
});

/**
 * Album share links: one live link per album — optionally expiring, optionally
 * password-protected (unlock issues a session token so the password never
 * rides on media URLs), optionally allowing original downloads. Public
 * viewers need no account.
 */
app.get<{ Params: { id: string } }>('/api/albums/:id/share', async (req, reply) => {
  const album = authorizeAlbum(bearer(req), req.params.id);
  if (!album) return reply.code(404).send({ error: 'not found' });
  const s = shareForAlbum(album.id);
  if (!s) return reply.send({ shared: false });
  return reply.send({
    shared: true,
    id: s.id,
    url: '/s/' + s.id,
    expiresAt: s.expiresAt,
    hasPassword: !!s.passwordHash,
    allowDownload: s.allowDownload,
  });
});

app.post<{
  Params: { id: string };
  Body: { expiresDays?: number; password?: string; allowDownload?: boolean };
}>('/api/albums/:id/share', async (req, reply) => {
  const token = bearer(req);
  const album = authorizeAlbum(token, req.params.id);
  if (!album) return reply.code(404).send({ error: 'not found' });
  const body = (req.body ?? {}) as { expiresDays?: number; password?: string; allowDownload?: boolean };
  const s = createShare(album.id, userIdForToken(token)!, {
    expiresDays: Number(body.expiresDays) || null,
    password: typeof body.password === 'string' && body.password ? body.password : null,
    allowDownload: !!body.allowDownload,
  });
  return reply.send({
    shared: true,
    id: s.id,
    url: '/s/' + s.id,
    expiresAt: s.expiresAt,
    hasPassword: !!s.passwordHash,
    allowDownload: s.allowDownload,
  });
});

app.delete<{ Params: { id: string } }>('/api/albums/:id/share', async (req, reply) => {
  const album = authorizeAlbum(bearer(req), req.params.id);
  if (!album) return reply.code(404).send({ error: 'not found' });
  revokeShare(album.id);
  return reply.send({ shared: false });
});

/** Public: share metadata + photo list (or a locked stub). */
app.get<{ Params: { sid: string }; Querystring: { st?: string } }>(
  '/api/share/:sid',
  async (req, reply) => {
    const s = getShare(req.params.sid);
    if (!s) return reply.code(404).send({ error: 'This link is invalid or has expired.' });
    const album = albumById(s.albumId);
    if (!album) return reply.code(404).send({ error: 'This album no longer exists.' });
    if (!shareUnlocked(s, req.query.st)) {
      return reply.send({ locked: true, name: album.name });
    }
    const photos = album.photoIds
      .map((pid) => photoById(pid))
      .filter((p): p is NonNullable<typeof p> => !!p && !p.deletedAt)
      .map((p) => ({
        id: p.id,
        filename: p.filename,
        createdAt: p.createdAt,
        width: p.width,
        height: p.height,
        mediaType: p.mediaType,
        duration: p.duration ?? null,
      }));
    return reply.send({
      locked: false,
      name: album.name,
      count: photos.length,
      allowDownload: s.allowDownload,
      photos,
    });
  },
);

app.post<{ Params: { sid: string }; Body: { password?: string } }>(
  '/api/share/:sid/unlock',
  async (req, reply) => {
    const body = (req.body ?? {}) as { password?: string };
    const st = unlockShare(req.params.sid, String(body.password ?? ''));
    if (!st) return reply.code(401).send({ error: 'Incorrect password' });
    return reply.send({ st });
  },
);

/** Resolve + gate a share-scoped photo request. */
function sharePhoto(sid: string, photoId: string, st: string | undefined) {
  const s = getShare(sid);
  if (!s || !shareUnlocked(s, st)) return null;
  const album = albumById(s.albumId);
  if (!album || !album.photoIds.includes(photoId)) return null;
  const photo = photoById(photoId);
  if (!photo || photo.deletedAt) return null;
  return { share: s, photo };
}

app.get<{ Params: { sid: string; photoId: string }; Querystring: { w?: string; st?: string } }>(
  '/api/share/:sid/thumb/:photoId',
  async (req, reply) => {
    const hit = sharePhoto(req.params.sid, req.params.photoId, req.query.st);
    if (!hit) return reply.code(404).send({ error: 'not found' });
    const file = await getSizedThumb(hit.photo.id, Number(req.query.w) || 256);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const buf = await fsp.readFile(file);
    reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=3600')
      .send(buf);
  },
);

app.get<{ Params: { sid: string; photoId: string }; Querystring: { w?: string; st?: string } }>(
  '/api/share/:sid/view/:photoId',
  async (req, reply) => {
    const hit = sharePhoto(req.params.sid, req.params.photoId, req.query.st);
    if (!hit) return reply.code(404).send({ error: 'not found' });
    const file = await getViewJpeg(hit.photo.id, Number(req.query.w) || 2560, hit.photo.filename);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const buf = await fsp.readFile(file);
    reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=3600')
      .send(buf);
  },
);

app.get<{ Params: { sid: string; photoId: string }; Querystring: { st?: string } }>(
  '/api/share/:sid/original/:photoId',
  async (req, reply) => {
    const hit = sharePhoto(req.params.sid, req.params.photoId, req.query.st);
    if (!hit) return reply.code(404).send({ error: 'not found' });
    // Originals are gated by allowDownload — except video, whose playback
    // needs the byte stream either way.
    if (!hit.share.allowDownload && hit.photo.mediaType !== 'video') {
      return reply.code(403).send({ error: 'downloads are disabled for this link' });
    }
    return streamStoredFile(req, reply, hit.photo, hit.photo.id, false);
  },
);

/** Metadata snapshots (Backup Health): list + take-now. Auth required. */
app.get('/api/backup/snapshots', async (req, reply) => {
  if (!userIdForToken(bearer(req))) return reply.code(401).send({ error: 'unauthorized' });
  return reply.send({ snapshots: await listSnapshots() });
});

app.post('/api/backup/snapshot', async (req, reply) => {
  if (!userIdForToken(bearer(req))) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const snap = await takeSnapshot();
    return reply.send({ ok: true, snapshot: snap });
  } catch {
    return reply.code(500).send({ error: 'could not write snapshot' });
  }
});

/** Library proxy with editedAt annotation (clients use it to cache-bust). */
app.get('/api/library', async (req, reply) => {
  const res = await fetch(`${ORIGIN}/api/library`, {
    headers: { Authorization: String(req.headers['authorization'] ?? '') },
  });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    const body = await res.text();
    return reply
      .code(res.status)
      .header('Content-Type', res.headers.get('content-type') ?? 'application/json')
      .send(body);
  }
  const json = (await res.json()) as { photos?: { id: string }[] };
  if (Array.isArray(json.photos)) json.photos = annotatePhotos(json.photos);
  return reply.send(json);
});

/** Size-aware thumbnail: /api/photos/:id/thumb?w=NNN → sharp resize + cache. */
app.get<{ Params: { id: string }; Querystring: { w?: string; raw?: string } }>(
  '/api/photos/:id/thumb',
  async (req, reply) => {
    const photo = authorizePhoto(bearer(req), req.params.id);
    if (!photo) return reply.code(404).send({ error: 'not found' });

    const requested = Number(req.query.w) || 256;
    // raw=1: the pristine, unedited render (the editor's base image).
    const file = await getSizedThumb(req.params.id, requested, req.query.raw === '1');
    if (!file) {
      // No local source (e.g. metadata-only video) → fall back to the origin's thumb.
      return reply.from(`/api/photos/${req.params.id}/thumb`);
    }
    const buf = await fsp.readFile(file);
    reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Length', String(buf.length))
      .send(buf);
  },
);

/** Full-resolution, browser-renderable JPEG for the viewer (HEIC decoded here). */
app.get<{ Params: { id: string }; Querystring: { w?: string } }>(
  '/api/photos/:id/view',
  async (req, reply) => {
    const photo = authorizePhoto(bearer(req), req.params.id);
    if (!photo) return reply.code(404).send({ error: 'not found' });
    if (photo.mediaType === 'video') return reply.code(404).send({ error: 'not an image' });

    const requested = Number(req.query.w) || 2560;
    const file = await getViewJpeg(req.params.id, requested, photo.filename);
    if (!file) return reply.from(`/api/photos/${req.params.id}/original`);
    const buf = await fsp.readFile(file);
    reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Length', String(buf.length))
      .send(buf);
  },
);

/** Original / video with HTTP Range support so playback streams in chunks. */
async function serveOriginal(req: any, reply: any, headOnly: boolean) {
  const photo = authorizePhoto(bearer(req), req.params.id);
  if (!photo) return reply.code(404).send({ error: 'not found' });
  return streamStoredFile(req, reply, photo, req.params.id, headOnly);
}

/** Range-capable file streaming for an ALREADY-authorized photo. */
async function streamStoredFile(
  req: any,
  reply: any,
  photo: { filename?: string; mediaType?: string },
  id: string,
  headOnly: boolean,
) {
  const filePath = path.join(ORIGINALS_DIR, id);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    // Not uploaded to this box yet → let the origin answer.
    return reply.from(`/api/photos/${id}/original`);
  }

  const type = contentTypeFor(photo.filename, photo.mediaType);
  const total = stat.size;
  const range = req.headers['range'] as string | undefined;

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', type);
  reply.header('Cache-Control', 'private, max-age=86400');

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end) {
      return reply.code(416).header('Content-Range', `bytes */${total}`).send();
    }
    reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${total}`)
      .header('Content-Length', String(end - start + 1));
    if (headOnly) return reply.send();
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }

  reply.header('Content-Length', String(total));
  if (headOnly) return reply.send();
  return reply.send(fs.createReadStream(filePath));
}

app.get('/api/photos/:id/original', { exposeHeadRoute: false }, (req, reply) =>
  serveOriginal(req, reply, false),
);
app.head('/api/photos/:id/original', (req, reply) => serveOriginal(req, reply, true));

// Routing for everything not matched above:
//  - /api/*  → proxy to the origin server (auth, library, albums, uploads, …)
//  - GET *   → serve the SPA's index.html (client-side routing) when web is built
//  - else    → 404
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api')) {
    return reply.from(req.url);
  }
  if (HAS_WEB && req.method === 'GET') {
    return reply.sendFile('index.html');
  }
  // No built web app: fall back to proxying (origin's own dashboard).
  if (!HAS_WEB) return reply.from(req.url);
  return reply.code(404).send({ error: 'not found' });
});

startSnapshotSchedule();

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`nook-gateway on :${PORT} → origin ${ORIGIN}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
