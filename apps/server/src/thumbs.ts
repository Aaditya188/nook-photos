/**
 * On-the-fly, size-bucketed thumbnails via sharp, cached to disk one file per
 * (id, width). Resizes from the origin's stored 1024px thumbnail when present,
 * else from the original. A tiny in-process job queue serializes heavy work so a
 * burst of grid requests can't oversubscribe the CPU.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { THUMBS_DIR, ORIGINALS_DIR, THUMB_CACHE_DIR, VIEW_CACHE_DIR, THUMB_WIDTHS } from './config.js';
import { applyRecipe, getEdit } from './edits.js';

// heic-convert is CommonJS with no types; require it to avoid ESM/type friction.
const require = createRequire(import.meta.url);
const heicConvert: (opts: { buffer: Buffer; format: 'JPEG'; quality: number }) => Promise<Buffer> =
  require('heic-convert');

export function nearestWidth(requested: number): number {
  for (const w of THUMB_WIDTHS) if (requested <= w) return w;
  return THUMB_WIDTHS[THUMB_WIDTHS.length - 1]!;
}

function cachePath(id: string, width: number, stamp: number): string {
  // The edit timestamp is part of the name: editing (or reverting) a photo
  // naturally invalidates every cached render of it.
  return path.join(THUMB_CACHE_DIR, stamp ? `${id}_e${stamp}_${width}.jpg` : `${id}_${width}.jpg`);
}

// ---- tiny concurrency-limited job queue (background heavy work) ----
const MAX_CONCURRENT = Math.max(2, (os.cpus?.().length ?? 4) - 2);
let active = 0;
const queue: (() => void)[] = [];

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      job()
        .then(resolve, reject)
        .finally(() => {
          active--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

const inflight = new Map<string, Promise<string>>();

/** Return the path to a cached JPEG of the given photo at ~`width` px (bucketed). */
export async function getSizedThumb(id: string, width: number, raw = false): Promise<string | null> {
  const w = nearestWidth(width);
  const edit = raw ? null : getEdit(id);
  const out = cachePath(id, w, edit?.editedAt ?? 0);
  if (fs.existsSync(out)) return out;

  const key = `${id}_${edit?.editedAt ?? 0}_${w}`;
  let job = inflight.get(key);
  if (!job) {
    job = schedule(async () => {
      await fsp.mkdir(THUMB_CACHE_DIR, { recursive: true });
      const src = pickSource(id);
      if (!src) throw new Error('no source image');
      const tmp = `${out}.${process.pid}.tmp`;
      let pipeline = sharp(src, { failOn: 'none' }).rotate();
      if (edit) pipeline = await applyRecipe(pipeline, edit.recipe);
      await pipeline
        .resize({ width: w, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(tmp);
      await fsp.rename(tmp, out); // atomic publish
      return out;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    return await job;
  } catch {
    return null;
  }
}

function pickSource(id: string): string | null {
  const thumb = path.join(THUMBS_DIR, `${id}.jpg`);
  if (fs.existsSync(thumb)) return thumb;
  const original = path.join(ORIGINALS_DIR, id);
  if (fs.existsSync(original)) return original;
  return null;
}

function isHeicName(name: string | undefined): boolean {
  return /\.(heic|heif)$/i.test(name ?? '');
}

/**
 * Full-resolution, browser-renderable JPEG for the viewer. Decodes HEIC/HEIF
 * originals via heic-convert (libheif WASM — sharp on this box lacks HEIF), else
 * resizes the original with sharp. Cached to disk per (id, width). Heavy work is
 * serialized through the same job queue as thumbnails.
 */
export async function getViewJpeg(id: string, width: number, filename?: string): Promise<string | null> {
  const w = Math.max(256, Math.min(4096, Math.round(width)));
  const edit = getEdit(id);
  const stamp = edit?.editedAt ?? 0;
  const out = path.join(VIEW_CACHE_DIR, stamp ? `${id}_e${stamp}_${w}.jpg` : `${id}_${w}.jpg`);
  if (fs.existsSync(out)) return out;

  const src = path.join(ORIGINALS_DIR, id);
  if (!fs.existsSync(src)) return null;

  const key = `view_${id}_${stamp}_${w}`;
  let job = inflight.get(key);
  if (!job) {
    job = schedule(async () => {
      await fsp.mkdir(VIEW_CACHE_DIR, { recursive: true });
      let pipeline: sharp.Sharp;
      if (isHeicName(filename)) {
        const input = await fsp.readFile(src);
        const jpeg = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
        pipeline = sharp(jpeg);
      } else {
        pipeline = sharp(src, { failOn: 'none' });
      }
      pipeline = pipeline.rotate();
      if (edit) pipeline = await applyRecipe(pipeline, edit.recipe);
      const tmp = `${out}.${process.pid}.tmp`;
      await pipeline
        .resize({ width: w, withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toFile(tmp);
      await fsp.rename(tmp, out);
      return out;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    return await job;
  } catch {
    return null;
  }
}
