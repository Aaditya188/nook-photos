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

// The web dashboard (apps/webui) — the improved vanilla-JS UI, served at /.
const WEB_DIST = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
  '..',
  'webui',
);
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

/** Size-aware thumbnail: /api/photos/:id/thumb?w=NNN → sharp resize + cache. */
app.get<{ Params: { id: string }; Querystring: { w?: string } }>(
  '/api/photos/:id/thumb',
  async (req, reply) => {
    const photo = authorizePhoto(bearer(req), req.params.id);
    if (!photo) return reply.code(404).send({ error: 'not found' });

    const requested = Number(req.query.w) || 256;
    const file = await getSizedThumb(req.params.id, requested);
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

  const filePath = path.join(ORIGINALS_DIR, req.params.id);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    // Not uploaded to this box yet → let the origin answer.
    return reply.from(`/api/photos/${req.params.id}/original`);
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

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`nook-gateway on :${PORT} → origin ${ORIGIN}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
