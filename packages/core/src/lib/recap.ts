/**
 * Year recap — a shareable highlight reel computed client-side from the library.
 * Shared by web and mobile. Picks the busiest year(s), tallies photos/videos/
 * favorites/active-days, monthly activity, and a spread of highlight photos.
 */
import type { PhotoRecord } from '../api/types';

const usable = (p: PhotoRecord) => !p.deletedAt && !p.hidden && p.uploadState === 'complete';

export interface Recap {
  year: number;
  photoCount: number;
  videoCount: number;
  favoriteCount: number;
  activeDays: number;
  byMonth: number[]; // length 12
  busiestDay: { date: string; count: number } | null;
  places: number; // distinct GPS ~1km cells
  highlights: PhotoRecord[]; // favorites first, spread across the year
}

/** Years (newest first) that have at least a handful of items. */
export function availableYears(photos: PhotoRecord[], min = 5): number[] {
  const counts = new Map<number, number>();
  for (const p of photos) {
    if (!usable(p)) continue;
    const y = new Date(p.createdAt).getFullYear();
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([y]) => y)
    .sort((a, b) => b - a);
}

export function recapForYear(photos: PhotoRecord[], year: number, maxHighlights = 30): Recap {
  const inYear = photos.filter((p) => usable(p) && new Date(p.createdAt).getFullYear() === year);
  const byMonth = new Array(12).fill(0);
  const byDay = new Map<string, number>();
  const cells = new Set<string>();
  let photoCount = 0;
  let videoCount = 0;
  let favoriteCount = 0;

  for (const p of inYear) {
    const d = new Date(p.createdAt);
    byMonth[d.getMonth()] += 1;
    const dk = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    byDay.set(dk, (byDay.get(dk) ?? 0) + 1);
    if (p.mediaType === 'video') videoCount += 1;
    else photoCount += 1;
    if (p.favorite) favoriteCount += 1;
    if (p.latitude != null && p.longitude != null && !(Math.abs(p.latitude) < 0.01 && Math.abs(p.longitude) < 0.01)) {
      cells.add(Math.round(p.latitude / 0.01) + ':' + Math.round(p.longitude / 0.01));
    }
  }

  let busiestDay: Recap['busiestDay'] = null;
  for (const [date, count] of byDay) if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };

  // Highlights: all favorites first, then fill by spreading across months for
  // variety, capped at maxHighlights.
  const favs = inYear.filter((p) => p.favorite);
  const rest = inYear.filter((p) => !p.favorite);
  const spread: PhotoRecord[] = [];
  if (rest.length) {
    const step = Math.max(1, Math.floor(rest.length / maxHighlights));
    for (let i = 0; i < rest.length && spread.length < maxHighlights; i += step) spread.push(rest[i]!);
  }
  const seen = new Set<string>();
  const highlights: PhotoRecord[] = [];
  for (const p of [...favs, ...spread]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    highlights.push(p);
    if (highlights.length >= maxHighlights) break;
  }

  return {
    year,
    photoCount,
    videoCount,
    favoriteCount,
    activeDays: byDay.size,
    byMonth,
    busiestDay,
    places: cells.size,
    highlights,
  };
}
