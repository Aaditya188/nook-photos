/**
 * Shared photo helpers: thumbnail-size bucketing (so the responsive grid reuses a
 * small set of cached sizes), EXIF formatting, byte formatting, and date grouping.
 */
import type { PhotoRecord } from '../api/types';

/** Discrete thumbnail widths (px). Requests snap up to the nearest bucket so the
 *  server (and HTTP cache) only ever materialize a handful of sizes per photo. */
export const THUMB_BUCKETS = [96, 128, 160, 200, 256, 320, 400, 512, 640, 1024] as const;

export function thumbBucket(targetPx: number): number {
  for (const b of THUMB_BUCKETS) if (targetPx <= b) return b;
  return THUMB_BUCKETS[THUMB_BUCKETS.length - 1]!;
}

export function humanBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatAperture(f: number | null): string | null {
  return f == null ? null : `ƒ/${f % 1 === 0 ? f.toFixed(0) : f.toFixed(1)}`;
}

export function formatExposure(sec: number | null): string | null {
  if (sec == null) return null;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `1/${Math.round(1 / sec)}s`;
}

export function formatFocal(mm: number | null): string | null {
  return mm == null ? null : `${Math.round(mm)} mm`;
}

export function formatIso(iso: number | null): string | null {
  return iso == null ? null : `ISO ${iso}`;
}

export function formatDuration(sec: number | null): string | null {
  if (sec == null) return null;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export interface PhotoSection {
  key: string;
  title: string;
  photos: PhotoRecord[];
}

/** Group photos (assumed newest-first) into day sections with friendly titles. */
export function groupByDay(photos: PhotoRecord[], now = new Date()): PhotoSection[] {
  const today = startOfDay(now).getTime();
  const yesterday = today - 86_400_000;
  const sections: PhotoSection[] = [];
  const index = new Map<string, PhotoSection>();

  for (const p of photos) {
    const d = new Date(p.createdAt);
    const day = startOfDay(d).getTime();
    const key = String(day);
    let title: string;
    if (day === today) title = 'Today';
    else if (day === yesterday) title = 'Yesterday';
    else title = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });

    let section = index.get(key);
    if (!section) {
      section = { key, title, photos: [] };
      index.set(key, section);
      sections.push(section);
    }
    section.photos.push(p);
  }
  return sections;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
