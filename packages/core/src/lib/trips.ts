/**
 * Trip detection — pure client-side clustering over the library.
 *
 * "Home" is the densest ~5km GPS cell across the whole library. A trip is a
 * run of consecutive days whose photos are >50km from home, merged across
 * gaps of up to 2 days, kept when it spans ≥2 days or has ≥15 photos.
 * Photos without GPS taken during a trip's days ride along.
 */
import type { PhotoRecord } from '../api/types';

export interface Trip {
  id: string; // start day key — stable across recomputes
  start: Date;
  end: Date;
  photos: PhotoRecord[];
  cover: PhotoRecord;
  /** Mean away-photo position (map/geocode hooks later). */
  centroid: { lat: number; lon: number } | null;
}

const CELL = 0.05; // ≈5 km grid for home detection
const AWAY_KM = 50;
const MERGE_GAP_DAYS = 2;
const MIN_DAYS = 2;
const MIN_PHOTOS = 15;

function hasGps(p: PhotoRecord): boolean {
  return (
    p.latitude != null &&
    p.longitude != null &&
    !(Math.abs(p.latitude) < 0.01 && Math.abs(p.longitude) < 0.01) &&
    Math.abs(p.latitude) <= 85
  );
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** The densest GPS cell = home. Null when the library has too little GPS. */
export function detectHome(photos: PhotoRecord[]): { lat: number; lon: number } | null {
  const bins = new Map<string, { n: number; lat: number; lon: number }>();
  for (const p of photos) {
    if (!hasGps(p)) continue;
    const key = Math.round(p.latitude! / CELL) + ':' + Math.round(p.longitude! / CELL);
    const b = bins.get(key);
    if (b) {
      b.n += 1;
      b.lat += p.latitude!;
      b.lon += p.longitude!;
    } else {
      bins.set(key, { n: 1, lat: p.latitude!, lon: p.longitude! });
    }
  }
  let best: { n: number; lat: number; lon: number } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  if (!best || best.n < 20) return null;
  return { lat: best.lat / best.n, lon: best.lon / best.n };
}

export function detectTrips(photos: PhotoRecord[]): Trip[] {
  const visible = photos.filter((p) => !p.hidden);
  const home = detectHome(visible);
  if (!home) return [];

  // Away days: any day with ≥1 photo >AWAY_KM from home.
  const awayDays = new Set<string>();
  for (const p of visible) {
    if (!hasGps(p)) continue;
    if (haversineKm(home.lat, home.lon, p.latitude!, p.longitude!) > AWAY_KM) {
      awayDays.add(dayKey(p.createdAt));
    }
  }
  if (awayDays.size === 0) return [];

  // Merge away days (sorted) across small gaps into runs.
  const days = [...awayDays].sort();
  const runs: string[][] = [];
  let cur: string[] = [days[0]];
  for (let i = 1; i < days.length; i++) {
    const gap =
      (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000;
    if (gap <= MERGE_GAP_DAYS + 1) cur.push(days[i]);
    else {
      runs.push(cur);
      cur = [days[i]];
    }
  }
  runs.push(cur);

  // Collect every photo (GPS or not) taken on a run's days.
  const byDay = new Map<string, PhotoRecord[]>();
  for (const p of visible) {
    const k = dayKey(p.createdAt);
    const arr = byDay.get(k);
    if (arr) arr.push(p);
    else byDay.set(k, [p]);
  }

  const trips: Trip[] = [];
  for (const run of runs) {
    const tripPhotos: PhotoRecord[] = [];
    for (const day of run) {
      const dayStart = Date.parse(day);
      // include the full inclusive range (covers gap days inside the run)
      void dayStart;
    }
    const first = Date.parse(run[0]);
    const last = Date.parse(run[run.length - 1]);
    for (const [k, arr] of byDay) {
      const t = Date.parse(k);
      if (t >= first && t <= last) tripPhotos.push(...arr);
    }
    const spanDays = Math.round((last - first) / 86400000) + 1;
    if (spanDays < MIN_DAYS && tripPhotos.length < MIN_PHOTOS) continue;
    if (tripPhotos.length === 0) continue;
    tripPhotos.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    // Centroid of away photos (for a future map/geocode).
    let lat = 0;
    let lon = 0;
    let n = 0;
    for (const p of tripPhotos) {
      if (hasGps(p) && haversineKm(home.lat, home.lon, p.latitude!, p.longitude!) > AWAY_KM) {
        lat += p.latitude!;
        lon += p.longitude!;
        n += 1;
      }
    }

    trips.push({
      id: run[0],
      start: new Date(first),
      end: new Date(last),
      photos: tripPhotos,
      cover: tripPhotos[Math.floor(tripPhotos.length / 2)] ?? tripPhotos[0],
      centroid: n > 0 ? { lat: lat / n, lon: lon / n } : null,
    });
  }

  trips.sort((a, b) => b.start.getTime() - a.start.getTime());
  return trips;
}

export function tripTitle(t: Trip): string {
  const sameMonth =
    t.start.getMonth() === t.end.getMonth() && t.start.getFullYear() === t.end.getFullYear();
  const sameYear = t.start.getFullYear() === t.end.getFullYear();
  const yr = t.end.getFullYear() !== new Date().getFullYear() ? ', ' + t.end.getFullYear() : '';
  const m = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  if (t.start.getTime() === t.end.getTime()) return m(t.start) + ' ' + t.start.getDate() + yr;
  if (sameMonth) return m(t.start) + ' ' + t.start.getDate() + '–' + t.end.getDate() + yr;
  if (sameYear) return m(t.start) + ' ' + t.start.getDate() + ' – ' + m(t.end) + ' ' + t.end.getDate() + yr;
  return (
    m(t.start) + ' ' + t.start.getFullYear() + ' – ' + m(t.end) + ' ' + t.end.getFullYear()
  );
}
