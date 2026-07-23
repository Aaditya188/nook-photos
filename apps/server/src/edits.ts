/**
 * Non-destructive photo edits. An edit is a stored *recipe* (rotate / flip /
 * crop / light & color); originals are never touched. Recipes live in one
 * JSON file beside the caches; thumbnail and view renders apply the recipe,
 * with the recipe's timestamp folded into cache filenames so stale renders
 * can't be served. Deleting the recipe reverts the photo instantly.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type sharp from 'sharp';
import { DATA_DIR } from './config.js';

export interface EditRecipe {
  /** Clockwise rotation applied after EXIF auto-orientation. */
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  /** Crop rect as fractions (0..1) of the rotated/flipped image. */
  crop?: { x: number; y: number; w: number; h: number };
  /** 1 = neutral; sane range ~0.5..1.6. */
  brightness?: number;
  /** 1 = neutral; sane range ~0.5..1.6. */
  contrast?: number;
  /** 1 = neutral; 0 = grayscale; up to 2. */
  saturation?: number;
  /** -1 (cool) .. 1 (warm); 0 = neutral. */
  warmth?: number;
}

interface EditEntry {
  recipe: EditRecipe;
  editedAt: number;
}

const EDITS_PATH = path.join(DATA_DIR, 'edits.json');

const edits = new Map<string, EditEntry>();
try {
  const raw = JSON.parse(fs.readFileSync(EDITS_PATH, 'utf8')) as Record<string, EditEntry>;
  for (const [id, e] of Object.entries(raw)) {
    if (e && e.recipe && typeof e.editedAt === 'number') edits.set(id, e);
  }
} catch {
  /* first run */
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const obj: Record<string, EditEntry> = {};
    for (const [id, e] of edits) obj[id] = e;
    const tmp = `${EDITS_PATH}.${process.pid}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(obj));
      await fsp.rename(tmp, EDITS_PATH); // atomic publish
    } catch {
      /* next mutation retries */
    }
  }, 300);
}

const num = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Validate + normalize an incoming recipe; null if it is a no-op. */
export function sanitizeRecipe(input: unknown): EditRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const out: EditRecipe = {};
  const rot = Number(r.rotate);
  if (rot === 90 || rot === 180 || rot === 270) out.rotate = rot;
  if (r.flipH === true) out.flipH = true;
  if (r.flipV === true) out.flipV = true;
  if (r.crop && typeof r.crop === 'object') {
    const c = r.crop as Record<string, unknown>;
    const x = num(c.x, 0, 0.98, 0);
    const y = num(c.y, 0, 0.98, 0);
    const w = num(c.w, 0.02, 1, 1);
    const h = num(c.h, 0.02, 1, 1);
    if (x > 0.001 || y > 0.001 || w < 0.999 || h < 0.999) {
      out.crop = { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
    }
  }
  const b = num(r.brightness, 0.4, 1.8, 1);
  const ct = num(r.contrast, 0.4, 1.8, 1);
  const s = num(r.saturation, 0, 2.2, 1);
  const wm = num(r.warmth, -1, 1, 0);
  if (Math.abs(b - 1) > 0.005) out.brightness = b;
  if (Math.abs(ct - 1) > 0.005) out.contrast = ct;
  if (Math.abs(s - 1) > 0.005) out.saturation = s;
  if (Math.abs(wm) > 0.005) out.warmth = wm;
  return Object.keys(out).length ? out : null;
}

export function getEdit(id: string): EditEntry | null {
  return edits.get(id) ?? null;
}

export function setEdit(id: string, recipe: EditRecipe): number {
  const editedAt = Date.now();
  edits.set(id, { recipe, editedAt });
  persist();
  return editedAt;
}

export function clearEdit(id: string): boolean {
  const had = edits.delete(id);
  if (had) persist();
  return had;
}

/** Annotate a library payload's photos with their editedAt stamps. */
export function annotatePhotos<T extends { id: string }>(photos: T[]): (T & { editedAt?: number })[] {
  if (edits.size === 0) return photos;
  return photos.map((p) => {
    const e = edits.get(p.id);
    return e ? { ...p, editedAt: e.editedAt } : p;
  });
}

/**
 * Apply a recipe to a sharp pipeline. Order matters and mirrors the editor:
 * EXIF auto-orient (caller does .rotate() first) → user rotate → flips → crop
 * → light/color. Crop fractions are resolved against the post-rotation size.
 */
export async function applyRecipe(pipeline: sharp.Sharp, recipe: EditRecipe): Promise<sharp.Sharp> {
  let p = pipeline;
  if (recipe.rotate) p = p.rotate(recipe.rotate);
  if (recipe.flipH) p = p.flop();
  if (recipe.flipV) p = p.flip();
  if (recipe.crop) {
    const meta = await pipeline.metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    // EXIF orientations 5-8 and user rotations of 90/270 each swap the axes;
    // the net effect is their XOR.
    const exifSwaps = (meta.orientation ?? 1) >= 5;
    const userSwaps = recipe.rotate === 90 || recipe.rotate === 270;
    if (exifSwaps !== userSwaps) [w, h] = [h, w];
    if (w > 0 && h > 0) {
      const c = recipe.crop;
      const left = Math.round(c.x * w);
      const top = Math.round(c.y * h);
      const width = Math.max(8, Math.min(w - left, Math.round(c.w * w)));
      const height = Math.max(8, Math.min(h - top, Math.round(c.h * h)));
      p = p.extract({ left, top, width, height });
    }
  }
  const modulate: { brightness?: number; saturation?: number } = {};
  if (recipe.brightness) modulate.brightness = recipe.brightness;
  if (recipe.saturation !== undefined) modulate.saturation = recipe.saturation;
  if (Object.keys(modulate).length) p = p.modulate(modulate);
  if (recipe.contrast) {
    const a = recipe.contrast;
    p = p.linear(a, 128 * (1 - a));
  }
  if (recipe.warmth) {
    const wmt = recipe.warmth * 0.14;
    p = p.recomb([
      [1 + wmt, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - wmt],
    ]);
  }
  return p;
}
