#!/usr/bin/env node
/**
 * Nook Photos server v2 (accounts) — zero-dependency Node.js (>= 16) file server.
 * Implements the API contract in ../docs/API.md.
 *
 * Uses only: http, fs, path, crypto, os. No npm packages, no global fetch,
 * no node:sqlite — safe to run on stock Node 16.
 *
 * Auth is per-user with bearer tokens. The server starts unclaimed; the first
 * account created via POST /api/setup becomes the admin. There is no shared key.
 *
 * Env (all optional):
 *   NOOK_PORT                 listen port                     (default 8080)
 *   NOOK_SERVER_NAME          display name of the server      (default os.hostname())
 *   NOOK_SERVER_MODEL         hardware label                  (default /proc/cpuinfo Model, else "")
 *   NOOK_STORAGE_TOTAL_BYTES  capacity to report              (default data-disk total, else 1 TB)
 *   NOOK_DATA_DIR             where db/originals/thumbs live  (default ./data)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VERSION = '2.0';
const PORT = parseInt(process.env.NOOK_PORT, 10) || 8080;
const SERVER_NAME = process.env.NOOK_SERVER_NAME || os.hostname();
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB raw-body cap
const MAX_JSON_BYTES = 10 * 1024 * 1024; // 10 MB JSON-body cap
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

// Local AI indexer (nook-indexer) — optional Python sidecar on the same host.
const INDEXER_URL = process.env.NOOK_INDEXER_URL || 'http://127.0.0.1:8091';
const INDEXER_SECRET = process.env.NOOK_INDEXER_SECRET || 'nook-indexer-dev';
let indexerAvailable = false;

const ROOT = __dirname;
const DATA_DIR = path.resolve(ROOT, process.env.NOOK_DATA_DIR || 'data');
const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let SERVER_MODEL = ''; // resolved in bootFs()
let TOTAL_BYTES = 1000000000000; // resolved in bootFs()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function detectModel() {
  if (process.env.NOOK_SERVER_MODEL) return process.env.NOOK_SERVER_MODEL;
  try {
    const txt = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^Model\s*:\s*(.+)$/.exec(lines[i].trim());
      if (m) return m[1].trim();
    }
  } catch (err) {
    /* not a Pi / no /proc — fall through */
  }
  return '';
}

function detectTotalBytes(dir) {
  const envVal = process.env.NOOK_STORAGE_TOTAL_BYTES;
  if (envVal) {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync(dir);
      const total = st.blocks * st.bsize;
      if (Number.isFinite(total) && total > 0) return total;
    }
  } catch (err) {
    /* statfsSync unavailable (Node 16) or failed — fall through */
  }
  return 1000000000000; // 1 TB
}

// ---------------------------------------------------------------------------
// Persistence
// db.json: {users:[], tokens:{token:{userId,createdAt}}, photos:[], albums:[]}
// ---------------------------------------------------------------------------

const db = { users: [], tokens: {}, photos: [], albums: [] };

function bootFs() {
  for (const dir of [DATA_DIR, ORIGINALS_DIR, THUMBS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (raw && Array.isArray(raw.users)) db.users = raw.users;
      if (raw && raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens)) db.tokens = raw.tokens;
      if (raw && Array.isArray(raw.photos)) db.photos = raw.photos;
      if (raw && Array.isArray(raw.albums)) db.albums = raw.albums;
    } catch (err) {
      console.error('warn: could not parse ' + DB_PATH + ', starting empty: ' + err.message);
    }
  }
  SERVER_MODEL = detectModel();
  TOTAL_BYTES = detectTotalBytes(DATA_DIR);
}

/** Atomic persist: write a temp file in the same dir, then rename over db.json. */
function persist() {
  const tmp = DB_PATH + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

/** Atomic binary write (temp + rename) so a crashed upload never leaves a torn file. */
function writeFileAtomic(dest, buf) {
  const tmp = dest + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

function genId(prefix, existsFn) {
  for (;;) {
    const id = prefix + crypto.randomBytes(4).toString('hex'); // 8 hex chars
    if (!existsFn(id)) return id;
  }
}

function findUser(id) {
  return db.users.find((u) => u.id === id) || null;
}
function findUserByUsername(username) {
  return db.users.find((u) => u.username === username) || null;
}
function findPhoto(id) {
  return db.photos.find((p) => p.id === id) || null;
}
function findAlbum(id) {
  return db.albums.find((a) => a.id === id) || null;
}

function originalPath(id) {
  return path.join(ORIGINALS_DIR, id);
}
function thumbPath(id) {
  return path.join(THUMBS_DIR, id + '.jpg');
}

// ---------------------------------------------------------------------------
// Recently Deleted (soft delete + 30-day retention)
// A DELETE marks a photo with `deletedAt` instead of removing it. Deleted
// photos are hidden from the library/albums/status but stay on disk so they can
// be restored, until they age past RETENTION_MS and the purge sweep hard-removes
// them.
// ---------------------------------------------------------------------------

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Permanently remove a photo: record, its files, and any album references. */
function hardRemovePhoto(photo) {
  db.photos = db.photos.filter((p) => p.id !== photo.id);
  for (const a of db.albums) {
    if (a.userId === photo.userId) {
      a.photoIds = a.photoIds.filter((pid) => pid !== photo.id);
      if (a.coverPhotoId === photo.id) a.coverPhotoId = null;
    }
  }
  for (const file of [originalPath(photo.id), thumbPath(photo.id)]) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      /* file may not exist; ignore */
    }
  }
}

/** Hard-remove every soft-deleted photo older than the retention window. */
function purgeExpiredDeleted() {
  const cutoff = Date.now() - RETENTION_MS;
  const expired = db.photos.filter((p) => {
    if (p.deletedAt == null) return false;
    const t = Date.parse(p.deletedAt);
    return Number.isFinite(t) && t <= cutoff;
  });
  if (expired.length === 0) return 0;
  for (const p of expired) hardRemovePhoto(p);
  persist();
  console.log('purged ' + expired.length + ' expired deleted photo(s)');
  return expired.length;
}

// ---------------------------------------------------------------------------
// Passwords & tokens
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return { saltHex: salt.toString('hex'), hashHex: hash.toString('hex') };
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored.saltHex !== 'string' || typeof stored.hashHex !== 'string') return false;
  const salt = Buffer.from(stored.saltHex, 'hex');
  const expected = Buffer.from(stored.hashHex, 'hex');
  if (expected.length === 0) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length);
  } catch (err) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function issueToken(userId) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  db.tokens[token] = { userId: userId, createdAt: new Date().toISOString() };
  return token;
}

// ---------------------------------------------------------------------------
// Public serializers (never leak password material or internal fields)
// ---------------------------------------------------------------------------

function toPublicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email == null ? null : u.email,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function toPublicPhoto(p) {
  return {
    id: p.id,
    userId: p.userId,
    localIdentifier: p.localIdentifier,
    filename: p.filename,
    createdAt: p.createdAt,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
    mediaType: p.mediaType,
    duration: p.duration == null ? null : p.duration,
    favorite: p.favorite === true,
    hidden: p.hidden === true,
    live: p.live === true,
    screenshot: p.screenshot === true,
    panorama: p.panorama === true,
    portrait: p.portrait === true,
    cameraMake: p.cameraMake == null ? null : p.cameraMake,
    cameraModel: p.cameraModel == null ? null : p.cameraModel,
    lensModel: p.lensModel == null ? null : p.lensModel,
    fNumber: p.fNumber == null ? null : p.fNumber,
    focalLength: p.focalLength == null ? null : p.focalLength,
    iso: p.iso == null ? null : p.iso,
    exposureTime: p.exposureTime == null ? null : p.exposureTime,
    latitude: p.latitude == null ? null : p.latitude,
    longitude: p.longitude == null ? null : p.longitude,
    uploadState: p.uploadState,
    deletedAt: p.deletedAt == null ? null : p.deletedAt,
    thumbUrl: '/api/photos/' + p.id + '/thumb',
    originalUrl: '/api/photos/' + p.id + '/original',
  };
}

function toPublicAlbum(a) {
  return {
    id: a.id,
    userId: a.userId,
    name: a.name,
    coverPhotoId: a.coverPhotoId == null ? null : a.coverPhotoId,
    photoCount: a.photoIds.length,
    photoIds: a.photoIds.slice(),
    createdAt: a.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Small HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  err.expose = true;
  return err;
}

/** Buffer the request body with a byte cap. Rejects with a 413 error over cap. */
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    function fail(err) {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      reject(err);
    }
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > cap) {
        fail(httpError(413, 'request body exceeds ' + cap + ' bytes'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(err));
    req.on('aborted', () => fail(new Error('request aborted')));
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req, MAX_JSON_BYTES);
  if (buf.length === 0) throw httpError(400, 'missing JSON body');
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw httpError(400, 'invalid JSON body: ' + err.message);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError(400, 'JSON body must be an object');
  }
  return parsed;
}

/**
 * Stream a file to the response. Resolves true if the file was served
 * (or the stream failed mid-flight), false if the file does not exist.
 */
// Serves a file, honoring HTTP `Range` requests (206 partial content) so
// AVPlayer/browsers can stream and seek video. `req` is optional; without it a
// plain 200 is sent.
function serveFile(res, filePath, contentType, req) {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        resolve(false);
        return;
      }
      const total = st.size;
      const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
      let status = 200;
      let start = 0;
      let end = total - 1;

      const rangeHeader = req && req.headers ? req.headers['range'] : null;
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
        if (m) {
          if (m[1] === '' && m[2] !== '') {
            // Suffix range: last N bytes.
            start = Math.max(0, total - parseInt(m[2], 10));
            end = total - 1;
          } else {
            if (m[1] !== '') start = parseInt(m[1], 10);
            if (m[2] !== '') end = parseInt(m[2], 10);
          }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + total });
            res.end();
            resolve(true);
            return;
          }
          end = Math.min(end, total - 1);
          status = 206;
          headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
        }
      }

      headers['Content-Length'] = end - start + 1;
      res.writeHead(status, headers);

      if (req && req.method === 'HEAD') {
        res.end();
        resolve(true);
        return;
      }

      const stream = fs.createReadStream(filePath, { start: start, end: end });
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
      };
      stream.on('error', () => {
        res.destroy();
        settle();
      });
      res.on('finish', settle);
      res.on('close', settle);
      stream.pipe(res);
    });
  });
}

function setupRequired() {
  return db.users.length === 0;
}

// ---------------------------------------------------------------------------
// Public API handlers
// ---------------------------------------------------------------------------

function handlePing(res) {
  sendJson(res, 200, { ok: true, server: 'nook', version: VERSION, setupRequired: setupRequired() });
}

function handleServer(res) {
  sendJson(res, 200, {
    name: SERVER_NAME,
    model: SERVER_MODEL,
    version: VERSION,
    setupRequired: setupRequired(),
    uptimeSec: Math.floor(process.uptime()),
    ai: indexerAvailable,
  });
}

// ---------------------------------------------------------------------------
// Local AI indexer proxy
// ---------------------------------------------------------------------------

/** Call the nook-indexer sidecar (localhost). Resolves parsed JSON or rejects. */
function indexerRequest(method, pathQuery, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(pathQuery, INDEXER_URL);
    } catch (e) {
      return reject(e);
    }
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: method,
        headers: Object.assign(
          { 'X-Indexer-Secret': INDEXER_SECRET },
          data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
        ),
        timeout: 8000,
      },
      (r) => {
        let chunks = '';
        r.on('data', (d) => (chunks += d));
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) {
            try {
              resolve(JSON.parse(chunks || '{}'));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error('indexer ' + r.statusCode));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('indexer timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function refreshIndexerHealth() {
  try {
    await indexerRequest('GET', '/health', null);
    indexerAvailable = true;
  } catch (e) {
    indexerAvailable = false;
  }
}

/** Map a list of photo ids to the caller's own, non-deleted public records,
 * preserving the given order. */
function ownedPublicPhotos(ids, user) {
  const byId = new Map(db.photos.map((p) => [p.id, p]));
  const out = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p && p.userId === user.id && p.deletedAt == null) out.push(toPublicPhoto(p));
  }
  return out;
}

async function handleSearch(res, user, query) {
  const q = (query.q || '').trim();
  const limit = Math.min(200, parseInt(query.limit, 10) || 60);
  if (!q) return sendJson(res, 200, { photos: [] });
  let results;
  try {
    const out = await indexerRequest('POST', '/search', { q: q, userId: user.id, limit: limit });
    results = out.results || [];
  } catch (e) {
    throw httpError(503, 'search is not available');
  }
  sendJson(res, 200, { photos: ownedPublicPhotos(results.map((r) => r.photoId), user) });
}

async function handlePeople(res, user) {
  let people;
  try {
    const out = await indexerRequest('GET', '/people?userId=' + encodeURIComponent(user.id), null);
    people = out.people || [];
  } catch (e) {
    throw httpError(503, 'people is not available');
  }
  const mine = new Set(db.photos.filter((p) => p.userId === user.id && p.deletedAt == null).map((p) => p.id));
  const mapped = people
    .filter((p) => mine.has(p.coverPhotoId))
    .map((p) => ({
      id: p.id,
      name: p.name || null,
      count: p.count,
      coverPhotoId: p.coverPhotoId,
      coverThumbUrl: '/api/photos/' + p.coverPhotoId + '/thumb',
      coverFace: Array.isArray(p.coverFace) && p.coverFace.length === 4 ? p.coverFace : null,
    }));
  sendJson(res, 200, { people: mapped });
}

async function handlePersonPhotos(res, user, personId) {
  let ids;
  try {
    const out = await indexerRequest(
      'GET',
      '/person-photos?userId=' + encodeURIComponent(user.id) + '&personId=' + encodeURIComponent(personId),
      null
    );
    ids = out.photoIds || [];
  } catch (e) {
    throw httpError(503, 'people is not available');
  }
  sendJson(res, 200, { photos: ownedPublicPhotos(ids, user) });
}

async function handlePatchPerson(req, res, user, personId) {
  const body = await readJsonBody(req);
  const payload = { userId: user.id, personId: personId };
  if (typeof body.name === 'string') payload.name = body.name;
  if (typeof body.hidden === 'boolean') payload.hidden = body.hidden;
  try {
    await indexerRequest('PATCH', '/person', payload);
  } catch (e) {
    throw httpError(503, 'people is not available');
  }
  sendJson(res, 200, { ok: true });
}

/** Merge one face cluster into another (all faces move; the source disappears). */
async function handleMergePeople(req, res, user) {
  const body = await readJsonBody(req);
  const fromId = typeof body.fromId === 'string' ? body.fromId : '';
  const intoId = typeof body.intoId === 'string' ? body.intoId : '';
  if (!fromId || !intoId || fromId === intoId) throw httpError(400, 'fromId and intoId required');
  let out;
  try {
    out = await indexerRequest('PATCH', '/person/merge', { userId: user.id, fromId, intoId });
  } catch (e) {
    throw httpError(503, 'people is not available');
  }
  sendJson(res, 200, { ok: true, moved: (out && out.moved) || 0 });
}

async function handlePlaces(res, user) {
  let places;
  try {
    const out = await indexerRequest('GET', '/places?userId=' + encodeURIComponent(user.id), null);
    places = out.places || [];
  } catch (e) {
    throw httpError(503, 'places is not available');
  }
  const mine = new Set(db.photos.filter((p) => p.userId === user.id && p.deletedAt == null).map((p) => p.id));
  const mapped = places
    .filter((pl) => mine.has(pl.coverPhotoId))
    .map((pl) => ({
      label: pl.label,
      count: pl.count,
      coverPhotoId: pl.coverPhotoId,
      coverThumbUrl: '/api/photos/' + pl.coverPhotoId + '/thumb',
    }));
  sendJson(res, 200, { places: mapped });
}

async function handlePlacePhotos(res, user, label) {
  let ids;
  try {
    const out = await indexerRequest(
      'GET',
      '/place-photos?userId=' + encodeURIComponent(user.id) + '&label=' + encodeURIComponent(label || ''),
      null
    );
    ids = out.photoIds || [];
  } catch (e) {
    throw httpError(503, 'places is not available');
  }
  sendJson(res, 200, { photos: ownedPublicPhotos(ids, user) });
}

function normalizeEmail(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw httpError(400, 'email must be a string');
  return v;
}

function makeUser(fields, role) {
  const id = genId('u_', (x) => db.users.some((u) => u.id === x));
  const user = {
    id: id,
    username: fields.username,
    displayName: fields.displayName,
    email: normalizeEmail(fields.email),
    role: role,
    createdAt: new Date().toISOString(),
    password: hashPassword(fields.password),
    lastBackupAt: null,
  };
  db.users.push(user);
  return user;
}

async function handleSetup(req, res) {
  if (!setupRequired()) throw httpError(409, 'setup already completed');
  const body = await readJsonBody(req);
  if (typeof body.username !== 'string' || body.username.length === 0) {
    throw httpError(400, 'username (non-empty string) is required');
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw httpError(400, 'password (non-empty string) is required');
  }
  if (typeof body.displayName !== 'string' || body.displayName.length === 0) {
    throw httpError(400, 'displayName (non-empty string) is required');
  }
  const user = makeUser(body, 'admin');
  const token = issueToken(user.id);
  persist();
  sendJson(res, 200, { token: token, user: toPublicUser(user) });
}

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw httpError(400, 'username and password are required');
  }
  const user = findUserByUsername(body.username);
  if (!user || !verifyPassword(body.password, user.password)) {
    throw httpError(401, 'invalid username or password');
  }
  const token = issueToken(user.id);
  persist();
  sendJson(res, 200, { token: token, user: toPublicUser(user) });
}

// ---------------------------------------------------------------------------
// Session API handlers (bearer)
// ---------------------------------------------------------------------------

function handleLogout(res, token) {
  if (token && db.tokens[token]) {
    delete db.tokens[token];
    persist();
  }
  sendJson(res, 200, { ok: true });
}

function handleGetAccount(res, user) {
  sendJson(res, 200, toPublicUser(user));
}

async function handlePatchAccount(req, res, user) {
  const body = await readJsonBody(req);
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName.length === 0) {
      throw httpError(400, 'displayName must be a non-empty string');
    }
    user.displayName = body.displayName;
  }
  if (body.email !== undefined) {
    user.email = normalizeEmail(body.email);
  }
  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== 'string' || body.newPassword.length === 0) {
      throw httpError(400, 'newPassword must be a non-empty string');
    }
    if (!verifyPassword(String(body.currentPassword == null ? '' : body.currentPassword), user.password)) {
      throw httpError(403, 'currentPassword is incorrect');
    }
    user.password = hashPassword(body.newPassword);
  }
  persist();
  sendJson(res, 200, toPublicUser(user));
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw httpError(403, 'admin privileges required');
}

function handleListUsers(res, user) {
  requireAdmin(user);
  sendJson(res, 200, { users: db.users.map(toPublicUser) });
}

async function handleCreateUser(req, res, user) {
  requireAdmin(user);
  const body = await readJsonBody(req);
  if (typeof body.username !== 'string' || body.username.length === 0) {
    throw httpError(400, 'username (non-empty string) is required');
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw httpError(400, 'password (non-empty string) is required');
  }
  if (typeof body.displayName !== 'string' || body.displayName.length === 0) {
    throw httpError(400, 'displayName (non-empty string) is required');
  }
  if (findUserByUsername(body.username)) {
    throw httpError(409, 'username already taken');
  }
  let role = 'member';
  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'member') {
      throw httpError(400, 'role must be "admin" or "member"');
    }
    role = body.role;
  }
  const created = makeUser(body, role);
  persist();
  sendJson(res, 201, toPublicUser(created));
}

function handleDeleteUser(res, user, targetId) {
  requireAdmin(user);
  const target = findUser(targetId);
  if (!target) throw httpError(404, 'no user with id ' + targetId);
  if (target.id === user.id) throw httpError(400, 'cannot delete your own account');
  if (target.role === 'admin') {
    const admins = db.users.filter((u) => u.role === 'admin').length;
    if (admins <= 1) throw httpError(400, 'cannot delete the last admin');
  }

  // Cascade: remove the user's photos (and files), albums, tokens, then the user.
  const ownedPhotos = db.photos.filter((p) => p.userId === target.id);
  for (const p of ownedPhotos) {
    for (const file of [originalPath(p.id), thumbPath(p.id)]) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        /* ignore missing files */
      }
    }
  }
  db.photos = db.photos.filter((p) => p.userId !== target.id);
  db.albums = db.albums.filter((a) => a.userId !== target.id);
  for (const tok of Object.keys(db.tokens)) {
    if (db.tokens[tok].userId === target.id) delete db.tokens[tok];
  }
  db.users = db.users.filter((u) => u.id !== target.id);
  persist();
  sendJson(res, 200, { ok: true });
}

function handleStatus(res, user) {
  let photoBytes = 0;
  let videoBytes = 0;
  let photos = 0;
  let videos = 0;
  const mine = db.photos.filter((p) => p.userId === user.id);
  let items = 0;
  for (const p of mine) {
    // Soft-deleted photos are excluded from the library counts, but their bytes
    // still occupy the disk until purged, so they stay in the storage totals.
    if (p.deletedAt == null) {
      if (p.mediaType === 'video') videos += 1;
      else photos += 1;
      items += 1;
    }
    if (p.uploadState === 'complete') {
      const b = Number(p.bytes) || 0;
      if (p.mediaType === 'video') videoBytes += b;
      else photoBytes += b;
    }
  }
  sendJson(res, 200, {
    server: {
      name: SERVER_NAME,
      model: SERVER_MODEL,
      version: VERSION,
      uptimeSec: Math.floor(process.uptime()),
    },
    storage: {
      usedBytes: photoBytes + videoBytes,
      totalBytes: TOTAL_BYTES,
      photoBytes: photoBytes,
      videoBytes: videoBytes,
    },
    library: {
      items: items,
      photos: photos,
      videos: videos,
      lastBackupAt: user.lastBackupAt || null,
    },
  });
}

function handleLibrary(res, user) {
  const sorted = db.photos
    .filter((p) => p.userId === user.id && p.deletedAt == null)
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta; // newest first
    });
  sendJson(res, 200, { photos: sorted.map(toPublicPhoto) });
}

// EXIF/GPS detail fields. All optional; each is either a string, a number, or null.
// Camera identity is stored as strings; the rest are numeric (iso is coerced to an integer).
const DETAIL_STRING_FIELDS = ['cameraMake', 'cameraModel', 'lensModel'];
const DETAIL_NUMBER_FIELDS = [
  { key: 'fNumber', nonNegative: true, integer: false },
  { key: 'focalLength', nonNegative: true, integer: false },
  { key: 'iso', nonNegative: true, integer: true },
  { key: 'exposureTime', nonNegative: true, integer: false },
  { key: 'latitude', nonNegative: false, integer: false },
  { key: 'longitude', nonNegative: false, integer: false },
];
const DETAIL_KEYS = DETAIL_STRING_FIELDS.concat(DETAIL_NUMBER_FIELDS.map((f) => f.key));

// Media subtypes (from PHAsset.mediaSubtypes) — booleans that drive the Browse
// / Media-Type categories. Absent → false.
const SUBTYPE_FIELDS = ['live', 'screenshot', 'panorama', 'portrait'];

/**
 * Validate and collect the EXIF/GPS detail fields that are *present* in `body`.
 * Returns an object holding only the provided keys (an explicit `null` is kept
 * as null). Absent keys are omitted so callers can distinguish "not sent" from
 * "sent as null" — this is what makes idempotent backfill on re-POST work.
 * Throws 400 on a wrong-typed value.
 */
function parseDetailFields(body) {
  const out = {};
  for (const key of DETAIL_STRING_FIELDS) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== 'string') throw httpError(400, key + ' must be a string or null');
    out[key] = v;
  }
  for (const f of DETAIL_NUMBER_FIELDS) {
    if (body[f.key] === undefined) continue;
    const v = body[f.key];
    if (v === null) {
      out[f.key] = null;
      continue;
    }
    const n = Number(v);
    if (typeof v === 'boolean' || !Number.isFinite(n)) throw httpError(400, f.key + ' must be a number or null');
    if (f.nonNegative && n < 0) throw httpError(400, f.key + ' must be >= 0');
    out[f.key] = f.integer ? Math.round(n) : n;
  }
  return out;
}

async function handleCreatePhoto(req, res, user) {
  const body = await readJsonBody(req);

  const localIdentifier = body.localIdentifier;
  if (typeof localIdentifier !== 'string' || localIdentifier.length === 0) {
    throw httpError(400, 'localIdentifier (non-empty string) is required');
  }

  const details = parseDetailFields(body); // validates provided EXIF/GPS fields (throws 400 on bad type)

  // Idempotent per (userId, localIdentifier): backfill any newly provided detail
  // fields onto the existing record and return it with 200 (a re-sync can add EXIF
  // that wasn't known on first upload). hidden/favorite are left to PATCH.
  const existing = db.photos.find((p) => p.userId === user.id && p.localIdentifier === localIdentifier);
  if (existing) {
    let changed = false;
    for (const key of Object.keys(details)) {
      existing[key] = details[key];
      changed = true;
    }
    // Media subtypes may be learned/corrected on a re-sync.
    for (const key of SUBTYPE_FIELDS) {
      if (typeof body[key] === 'boolean') {
        existing[key] = body[key];
        changed = true;
      }
    }
    if (changed) persist();
    sendJson(res, 200, toPublicPhoto(existing));
    return;
  }

  if (typeof body.filename !== 'string' || body.filename.length === 0) {
    throw httpError(400, 'filename (non-empty string) is required');
  }
  if (typeof body.createdAt !== 'string' || body.createdAt.length === 0) {
    throw httpError(400, 'createdAt (ISO-8601 string) is required');
  }
  const width = Number(body.width);
  const height = Number(body.height);
  const bytes = Number(body.bytes);
  if (!Number.isFinite(width) || width < 0) throw httpError(400, 'width (number) is required');
  if (!Number.isFinite(height) || height < 0) throw httpError(400, 'height (number) is required');
  if (!Number.isFinite(bytes) || bytes < 0) throw httpError(400, 'bytes (number) is required');
  if (body.mediaType !== 'photo' && body.mediaType !== 'video') {
    throw httpError(400, 'mediaType must be "photo" or "video"');
  }
  let duration = null;
  if (body.mediaType === 'video' && body.duration !== undefined && body.duration !== null) {
    duration = Number(body.duration);
    if (!Number.isFinite(duration) || duration < 0) throw httpError(400, 'duration must be a non-negative number');
  }

  const id = genId('p_', (x) => db.photos.some((p) => p.id === x));
  const record = {
    id: id,
    userId: user.id,
    localIdentifier: localIdentifier,
    filename: body.filename,
    createdAt: body.createdAt,
    width: width,
    height: height,
    bytes: bytes,
    mediaType: body.mediaType,
    duration: duration,
    favorite: body.favorite === true,
    hidden: body.hidden === true,
    live: body.live === true,
    screenshot: body.screenshot === true,
    panorama: body.panorama === true,
    portrait: body.portrait === true,
    // EXIF/GPS detail fields default to null; any provided in the body override below.
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    fNumber: null,
    focalLength: null,
    iso: null,
    exposureTime: null,
    latitude: null,
    longitude: null,
    uploadState: 'pending',
    deletedAt: null, // ISO-8601 string once soft-deleted; null while live
    contentType: null, // internal, not exposed
  };
  for (const key of Object.keys(details)) record[key] = details[key];
  db.photos.push(record);
  persist();
  sendJson(res, 201, toPublicPhoto(record));
}

async function handlePutThumb(req, res, photo) {
  const buf = await readBody(req, MAX_UPLOAD_BYTES);
  if (buf.length === 0) throw httpError(400, 'empty thumbnail body');
  writeFileAtomic(thumbPath(photo.id), buf);
  sendJson(res, 200, { ok: true });
}

async function handlePutOriginal(req, res, photo, user) {
  const buf = await readBody(req, MAX_UPLOAD_BYTES);
  if (buf.length === 0) throw httpError(400, 'empty original body');
  writeFileAtomic(originalPath(photo.id), buf);
  photo.bytes = buf.length; // actual stored size
  photo.contentType = req.headers['content-type'] || 'application/octet-stream';
  photo.uploadState = 'complete';
  user.lastBackupAt = new Date().toISOString();
  persist();
  sendJson(res, 200, { ok: true, uploadState: 'complete' });
}

async function handleGetThumb(req, res, photo) {
  const served = await serveFile(res, thumbPath(photo.id), 'image/jpeg', req);
  if (!served) throw httpError(404, 'thumbnail not uploaded for ' + photo.id);
}

async function handleGetOriginal(req, res, photo) {
  const type = photo.contentType || 'application/octet-stream';
  const served = await serveFile(res, originalPath(photo.id), type, req);
  if (!served) throw httpError(404, 'original not uploaded for ' + photo.id);
}

async function handlePatchPhoto(req, res, photo) {
  const body = await readJsonBody(req);
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== 'boolean') throw httpError(400, 'favorite must be a boolean');
    photo.favorite = body.favorite;
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') throw httpError(400, 'hidden must be a boolean');
    photo.hidden = body.hidden;
  }
  persist();
  sendJson(res, 200, toPublicPhoto(photo));
}

// Soft delete: mark the photo `deletedAt` (files kept) and drop it from albums
// so it disappears from the library/albums but can still be restored for 30
// days. Idempotent: re-deleting keeps the original timestamp/countdown.
function handleDeletePhoto(res, photo) {
  if (photo.deletedAt == null) {
    photo.deletedAt = new Date().toISOString();
    for (const a of db.albums) {
      if (a.userId === photo.userId) {
        a.photoIds = a.photoIds.filter((pid) => pid !== photo.id);
        if (a.coverPhotoId === photo.id) a.coverPhotoId = null;
      }
    }
    persist();
  }
  sendJson(res, 200, toPublicPhoto(photo));
}

// Restore a soft-deleted photo back to the library (not re-added to albums,
// matching Photos). No-op if it wasn't deleted.
function handleRestorePhoto(res, photo) {
  if (photo.deletedAt != null) {
    photo.deletedAt = null;
    persist();
  }
  sendJson(res, 200, toPublicPhoto(photo));
}

// Permanently remove one photo (record + files + album refs), regardless of
// whether it was in Recently Deleted.
function handlePermanentDeletePhoto(res, photo) {
  hardRemovePhoto(photo);
  persist();
  sendJson(res, 200, { ok: true });
}

// GET /api/deleted — the user's soft-deleted photos, most-recently-deleted first.
// Runs the purge sweep first so expired items never surface.
function handleListDeleted(res, user) {
  purgeExpiredDeleted();
  const sorted = db.photos
    .filter((p) => p.userId === user.id && p.deletedAt != null)
    .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
  sendJson(res, 200, { photos: sorted.map(toPublicPhoto) });
}

// DELETE /api/deleted — permanently empty the user's Recently Deleted.
function handleEmptyDeleted(res, user) {
  const mine = db.photos.filter((p) => p.userId === user.id && p.deletedAt != null);
  for (const p of mine) hardRemovePhoto(p);
  if (mine.length > 0) persist();
  sendJson(res, 200, { ok: true, removed: mine.length });
}

function handleListAlbums(res, user) {
  const mine = db.albums
    .filter((a) => a.userId === user.id)
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta;
    });
  sendJson(res, 200, { albums: mine.map(toPublicAlbum) });
}

async function handleCreateAlbum(req, res, user) {
  const body = await readJsonBody(req);
  if (typeof body.name !== 'string' || body.name.length === 0) {
    throw httpError(400, 'name (non-empty string) is required');
  }
  const id = genId('al_', (x) => db.albums.some((a) => a.id === x));
  const album = {
    id: id,
    userId: user.id,
    name: body.name,
    coverPhotoId: null,
    photoIds: [],
    createdAt: new Date().toISOString(),
  };
  db.albums.push(album);
  persist();
  sendJson(res, 201, toPublicAlbum(album));
}

function handleGetAlbum(res, album) {
  sendJson(res, 200, toPublicAlbum(album));
}

async function handlePatchAlbum(req, res, album, user) {
  const body = await readJsonBody(req);
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.length === 0) {
      throw httpError(400, 'name must be a non-empty string');
    }
    album.name = body.name;
  }
  // A soft-deleted photo can't be added to an album or set as a cover.
  const ownsPhoto = (pid) => db.photos.some((p) => p.id === pid && p.userId === user.id && p.deletedAt == null);

  if (body.addPhotoIds !== undefined) {
    if (!Array.isArray(body.addPhotoIds)) throw httpError(400, 'addPhotoIds must be an array');
    for (const pid of body.addPhotoIds) {
      if (typeof pid === 'string' && ownsPhoto(pid) && album.photoIds.indexOf(pid) === -1) {
        album.photoIds.push(pid);
      }
    }
  }
  if (body.removePhotoIds !== undefined) {
    if (!Array.isArray(body.removePhotoIds)) throw httpError(400, 'removePhotoIds must be an array');
    const remove = new Set(body.removePhotoIds);
    album.photoIds = album.photoIds.filter((pid) => !remove.has(pid));
    if (album.coverPhotoId != null && remove.has(album.coverPhotoId)) album.coverPhotoId = null;
  }
  if (body.coverPhotoId !== undefined) {
    if (body.coverPhotoId === null) {
      album.coverPhotoId = null;
    } else if (typeof body.coverPhotoId === 'string' && ownsPhoto(body.coverPhotoId)) {
      album.coverPhotoId = body.coverPhotoId;
    } else {
      throw httpError(400, 'coverPhotoId must be one of your own photo ids or null');
    }
  }
  persist();
  sendJson(res, 200, toPublicAlbum(album));
}

function handleDeleteAlbum(res, album) {
  db.albums = db.albums.filter((a) => a.id !== album.id);
  persist();
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// API routing
// ---------------------------------------------------------------------------

const PHOTO_ROUTE = /^\/api\/photos\/([A-Za-z0-9_-]+)(?:\/(thumb|original|restore|permanent))?$/;
const ALBUM_ROUTE = /^\/api\/albums\/([A-Za-z0-9_-]+)$/;
const USER_ROUTE = /^\/api\/users\/([A-Za-z0-9_-]+)$/;

/** Resolve a photo owned by `user` or throw 404 (hides existence of others'). */
function ownedPhoto(id, user) {
  const photo = findPhoto(id);
  if (!photo || photo.userId !== user.id) throw httpError(404, 'no photo with id ' + id);
  return photo;
}
function ownedAlbum(id, user) {
  const album = findAlbum(id);
  if (!album || album.userId !== user.id) throw httpError(404, 'no album with id ' + id);
  return album;
}

async function handleApi(req, res, pathname) {
  // CORS on all /api/* responses.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- Public routes (no token) ----
  if (pathname === '/api/ping' && req.method === 'GET') return handlePing(res);
  if (pathname === '/api/server' && req.method === 'GET') return handleServer(res);
  if (pathname === '/api/setup' && req.method === 'POST') return handleSetup(req, res);
  if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);

  // ---- Bearer auth for everything else ----
  const authHeader = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = m ? m[1].trim() : null;
  const rec = token ? db.tokens[token] : null;
  const user = rec ? findUser(rec.userId) : null;
  if (!user) throw httpError(401, 'unauthorized: missing or invalid token');

  // ---- Session routes ----
  if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(res, token);
  if (pathname === '/api/account' && req.method === 'GET') return handleGetAccount(res, user);
  if (pathname === '/api/account' && req.method === 'PATCH') return handlePatchAccount(req, res, user);
  if (pathname === '/api/users' && req.method === 'GET') return handleListUsers(res, user);
  if (pathname === '/api/users' && req.method === 'POST') return handleCreateUser(req, res, user);
  if (pathname === '/api/status' && req.method === 'GET') return handleStatus(res, user);
  if (pathname === '/api/library' && req.method === 'GET') return handleLibrary(res, user);

  // ---- Local AI (semantic search / people / places) ----
  const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  if (pathname === '/api/search' && req.method === 'GET') return handleSearch(res, user, query);
  if (pathname === '/api/people' && req.method === 'GET') return handlePeople(res, user);
  if (pathname === '/api/places' && req.method === 'GET') return handlePlaces(res, user);
  if (pathname === '/api/place-photos' && req.method === 'GET') return handlePlacePhotos(res, user, query.label || '');
  if (pathname === '/api/people/merge' && req.method === 'POST') return handleMergePeople(req, res, user);
  const personMatch = /^\/api\/people\/([A-Za-z0-9_-]+)(?:\/(photos))?$/.exec(pathname);
  if (personMatch) {
    const personId = personMatch[1];
    if (personMatch[2] === 'photos' && req.method === 'GET') return handlePersonPhotos(res, user, personId);
    if (!personMatch[2] && req.method === 'PATCH') return handlePatchPerson(req, res, user, personId);
  }

  if (pathname === '/api/deleted' && req.method === 'GET') return handleListDeleted(res, user);
  if (pathname === '/api/deleted' && req.method === 'DELETE') return handleEmptyDeleted(res, user);
  if (pathname === '/api/photos' && req.method === 'POST') return handleCreatePhoto(req, res, user);
  if (pathname === '/api/albums' && req.method === 'GET') return handleListAlbums(res, user);
  if (pathname === '/api/albums' && req.method === 'POST') return handleCreateAlbum(req, res, user);

  const um = USER_ROUTE.exec(pathname);
  if (um && req.method === 'DELETE') return handleDeleteUser(res, user, um[1]);

  const pm = PHOTO_ROUTE.exec(pathname);
  if (pm) {
    const id = pm[1];
    const sub = pm[2] || null;
    const photo = ownedPhoto(id, user);
    if (sub === 'thumb' && req.method === 'PUT') return handlePutThumb(req, res, photo);
    if (sub === 'thumb' && req.method === 'GET') return handleGetThumb(req, res, photo);
    if (sub === 'original' && req.method === 'PUT') return handlePutOriginal(req, res, photo, user);
    if (sub === 'original' && req.method === 'GET') return handleGetOriginal(req, res, photo);
    if (sub === 'restore' && req.method === 'POST') return handleRestorePhoto(res, photo);
    if (sub === 'permanent' && req.method === 'DELETE') return handlePermanentDeletePhoto(res, photo);
    if (sub === null && req.method === 'PATCH') return handlePatchPhoto(req, res, photo);
    if (sub === null && req.method === 'DELETE') return handleDeletePhoto(res, photo);
  }

  const am = ALBUM_ROUTE.exec(pathname);
  if (am) {
    const album = ownedAlbum(am[1], user);
    if (req.method === 'GET') return handleGetAlbum(res, album);
    if (req.method === 'PATCH') return handlePatchAlbum(req, res, album, user);
    if (req.method === 'DELETE') return handleDeleteAlbum(res, album);
  }

  throw httpError(404, 'not found: ' + req.method + ' ' + pathname);
}

// ---------------------------------------------------------------------------
// Static file serving (no auth): server/public/, SPA fallback to index.html
// ---------------------------------------------------------------------------

async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw httpError(404, 'not found: ' + req.method + ' ' + pathname);
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    throw httpError(400, 'malformed URL path');
  }
  if (decoded.indexOf('\0') !== -1) throw httpError(400, 'malformed URL path');

  if (decoded === '/') decoded = '/index.html';

  // Path-traversal guard: resolve, then require the result to stay in public/.
  const resolved = path.resolve(PUBLIC_DIR, '.' + decoded);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    throw httpError(400, 'path traversal rejected');
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  if (await serveFile(res, resolved, mime, req)) return;

  // SPA fallback: any unknown non-/api GET serves index.html.
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (resolved !== indexFile && (await serveFile(res, indexFile, MIME['.html'], req))) return;

  throw httpError(404, 'not found: ' + pathname);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function route(req, res, pathname) {
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname);
  } else {
    await handleStatic(req, res, pathname);
  }
}

const server = http.createServer((req, res) => {
  const start = Date.now();
  const rawPath = (req.url || '/').split('?')[0].split('#')[0] || '/';

  res.on('finish', () => {
    console.log(req.method + ' ' + rawPath + ' ' + res.statusCode + ' ' + (Date.now() - start) + 'ms');
  });

  route(req, res, rawPath).catch((err) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.expose ? err.message : 'internal server error';
    if (status === 500) {
      console.error('error handling ' + req.method + ' ' + rawPath + ':', err && err.stack ? err.stack : err);
    }
    try {
      sendJson(res, status, { error: message });
    } catch (e) {
      try {
        res.destroy();
      } catch (e2) {
        /* nothing left to do */
      }
    }
  });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n{"error":"bad request"}');
  else socket.destroy();
});

// Defensive: log but never crash the process on stray async errors.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

bootFs();
// Recently Deleted retention: purge on boot, then sweep every 6 hours so a
// long-running server clears items 30 days after they were deleted.
purgeExpiredDeleted();
const purgeTimer = setInterval(purgeExpiredDeleted, 6 * 60 * 60 * 1000);
if (typeof purgeTimer.unref === 'function') purgeTimer.unref();
// Track whether the local AI indexer is up, for the `ai` capability flag.
refreshIndexerHealth();
const aiTimer = setInterval(refreshIndexerHealth, 30 * 1000);
if (typeof aiTimer.unref === 'function') aiTimer.unref();
server.listen(PORT, () => {
  console.log(
    'nook server v' + VERSION + ' listening on http://0.0.0.0:' + PORT +
      ' | data=' + DATA_DIR +
      ' | name=' + SERVER_NAME +
      (SERVER_MODEL ? ' | model=' + SERVER_MODEL : '') +
      ' | ' + (setupRequired() ? 'UNCLAIMED (setup required)' : db.users.length + ' user(s)')
  );
});
