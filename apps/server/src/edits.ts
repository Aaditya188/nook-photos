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
import sharp from 'sharp';
import { DATA_DIR } from './config.js';

export interface EditRecipe {
  /** Clockwise rotation applied after EXIF auto-orientation. */
  rotate?: 0 | 90 | 180 | 270;
  /** Fine straighten in degrees (-15..15); the canvas is auto-cropped. */
  straighten?: number;
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
  /** -1 (recover/darken) .. 1 (lift); 0 = neutral. Bright regions only. */
  highlights?: number;
  /** -1 (crush) .. 1 (lift); 0 = neutral. Dark regions only. */
  shadows?: number;
  /** 0 (off) .. 1 (strong) darkened corners. */
  vignette?: number;
  /** 0 (off) .. 1 (strong). */
  sharpen?: number;
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
  const st = num(r.straighten, -15, 15, 0);
  const hl = num(r.highlights, -1, 1, 0);
  const sh = num(r.shadows, -1, 1, 0);
  const vg = num(r.vignette, 0, 1, 0);
  const sp = num(r.sharpen, 0, 1, 0);
  if (Math.abs(b - 1) > 0.005) out.brightness = b;
  if (Math.abs(ct - 1) > 0.005) out.contrast = ct;
  if (Math.abs(s - 1) > 0.005) out.saturation = s;
  if (Math.abs(wm) > 0.005) out.warmth = wm;
  if (Math.abs(st) > 0.05) out.straighten = st;
  if (Math.abs(hl) > 0.005) out.highlights = hl;
  if (Math.abs(sh) > 0.005) out.shadows = sh;
  if (vg > 0.005) out.vignette = vg;
  if (sp > 0.005) out.sharpen = sp;
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
 * EXIF auto-orient (caller does .rotate() first) → user rotate → straighten
 * (with inscribed auto-crop) → flips → crop → light/color/effects. Crop
 * fractions are resolved against the post-rotation size.
 */
export async function applyRecipe(pipeline: sharp.Sharp, recipe: EditRecipe): Promise<sharp.Sharp> {
  let p = pipeline;
  if (recipe.rotate) p = p.rotate(recipe.rotate);

  const meta = await pipeline.metadata();
  let w = meta.width ?? 0;
  let h = meta.height ?? 0;
  // EXIF orientations 5-8 and user rotations of 90/270 each swap the axes;
  // the net effect is their XOR.
  const exifSwaps = (meta.orientation ?? 1) >= 5;
  const userSwaps = recipe.rotate === 90 || recipe.rotate === 270;
  if (exifSwaps !== userSwaps) [w, h] = [h, w];

  if (recipe.straighten && w > 0 && h > 0) {
    // Free rotate on a black canvas, then crop the largest inscribed rect so
    // no wedges show. Materialize first: sharp can't chain a second rotate.
    const angle = recipe.straighten;
    const rad = (Math.abs(angle) * Math.PI) / 180;
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const rotated = await p.rotate(angle, { background: '#000' }).toBuffer();
    const rw = Math.floor(w * cosA + h * sinA);
    const rh = Math.floor(w * sinA + h * cosA);
    // Largest axis-aligned rectangle inside the rotated original (standard
    // "rotatedRectWithMaxArea"; angles ≤15° always hit the general branch).
    const cos2a = cosA * cosA - sinA * sinA;
    let iw: number;
    let ih: number;
    if (Math.abs(cos2a) < 1e-6) {
      iw = Math.floor(Math.min(w, h) / 2 / Math.max(sinA, cosA));
      ih = iw;
    } else {
      iw = Math.floor((w * cosA - h * sinA) / cos2a);
      ih = Math.floor((h * cosA - w * sinA) / cos2a);
    }
    iw = Math.max(8, Math.min(iw, rw));
    ih = Math.max(8, Math.min(ih, rh));
    p = sharp(rotated).extract({
      left: Math.max(0, Math.floor((rw - iw) / 2)),
      top: Math.max(0, Math.floor((rh - ih) / 2)),
      width: iw,
      height: ih,
    });
    w = iw;
    h = ih;
  }

  if (recipe.flipH) p = p.flop();
  if (recipe.flipV) p = p.flip();
  if (recipe.crop && w > 0 && h > 0) {
    const c = recipe.crop;
    const left = Math.round(c.x * w);
    const top = Math.round(c.y * h);
    const width = Math.max(8, Math.min(w - left, Math.round(c.w * w)));
    const height = Math.max(8, Math.min(h - top, Math.round(c.h * h)));
    p = p.extract({ left, top, width, height });
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

  // Tone (highlights/shadows) and vignette need per-pixel work: round-trip
  // through raw pixels once, only when those fields are present.
  if (recipe.highlights || recipe.shadows || recipe.vignette) {
    const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
    applyTonePass(data, info.width, info.height, info.channels, recipe);
    p = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels as 3 | 4 } });
  }

  if (recipe.sharpen) {
    p = p.sharpen({ sigma: 0.6 + recipe.sharpen * 1.6 });
  }
  return p;
}

/**
 * In-place tone + vignette on interleaved 8-bit pixels. Luminance-weighted:
 * highlights only touch bright regions, shadows only dark ones; the identical
 * formulas drive the web editor's accurate preview.
 */
export function applyTonePass(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  recipe: Pick<EditRecipe, 'highlights' | 'shadows' | 'vignette'>,
): void {
  const hl = recipe.highlights ?? 0;
  const sh = recipe.shadows ?? 0;
  const vg = recipe.vignette ?? 0;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (hl || sh) {
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const wHl = smooth(0.45, 0.95, lum);
        const wSh = 1 - smooth(0.05, 0.55, lum);
        for (let c = 0; c < 3; c++) {
          let v = data[i + c]! / 255;
          if (hl) v += hl * wHl * (hl > 0 ? (1 - v) * 0.85 : v * 0.55);
          if (sh) v += sh * wSh * (sh > 0 ? (1 - v) * 0.55 : v * 0.85);
          data[i + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
      }
      if (vg) {
        const dx = x - cx;
        const dy = y - cy;
        const rr = Math.sqrt(dx * dx + dy * dy) / maxR;
        const vigMul = 1 - vg * smooth(0.55, 1.05, rr) * 0.75;
        data[i] = Math.round(data[i]! * vigMul);
        data[i + 1] = Math.round(data[i + 1]! * vigMul);
        data[i + 2] = Math.round(data[i + 2]! * vigMul);
      }
    }
  }
}
