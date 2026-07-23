import path from 'node:path';

/** Data dir shared with the origin Nook server (db.json, originals/, thumbs/). */
export const DATA_DIR = process.env.NOOK_DATA_DIR
  ? path.resolve(process.env.NOOK_DATA_DIR)
  : 'D:\\photos';

/** Origin server everything non-media is proxied to (the proven zero-dep server.js). */
export const ORIGIN = process.env.NOOK_ORIGIN ?? 'http://127.0.0.1:8080';

/** Port this gateway listens on (distinct from the origin's 8080). */
export const PORT = Number(process.env.NOOK_GATEWAY_PORT ?? 8090);

export const DB_PATH = path.join(DATA_DIR, 'db.json');
export const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
/** Where resized thumbnails are cached, one file per (id, width). */
export const THUMB_CACHE_DIR = path.join(DATA_DIR, 'thumb-cache');
/** Where full-res view JPEGs are cached (incl. HEIC decoded to JPEG). */
export const VIEW_CACHE_DIR = path.join(DATA_DIR, 'view-cache');

/** Discrete widths we resize to (mirrors the client's THUMB_BUCKETS). */
export const THUMB_WIDTHS = [96, 128, 160, 200, 256, 320, 400, 512, 640, 1024];
