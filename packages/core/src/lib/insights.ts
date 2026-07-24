/**
 * Storage insights + duplicate detection — pure client-side analysis over the
 * library, shared by web and mobile. No server support needed: byte sizes,
 * dimensions and dates already live on every PhotoRecord.
 */
import type { PhotoRecord } from '../api/types';

export interface Bucket {
  count: number;
  bytes: number;
}
export interface YearBucket extends Bucket {
  year: number;
}
export interface StorageInsights {
  total: Bucket;
  photos: Bucket;
  videos: Bucket;
  byYear: YearBucket[]; // newest year first
  largest: PhotoRecord[]; // biggest items, largest first
}

const usable = (p: PhotoRecord) => !p.deletedAt && p.uploadState === 'complete';

export function storageInsights(photos: PhotoRecord[], topN = 12): StorageInsights {
  const total: Bucket = { count: 0, bytes: 0 };
  const pics: Bucket = { count: 0, bytes: 0 };
  const vids: Bucket = { count: 0, bytes: 0 };
  const years = new Map<number, YearBucket>();

  for (const p of photos) {
    if (!usable(p)) continue;
    const b = p.bytes || 0;
    total.count += 1;
    total.bytes += b;
    const isVideo = p.mediaType === 'video';
    const bucket = isVideo ? vids : pics;
    bucket.count += 1;
    bucket.bytes += b;
    const year = new Date(p.createdAt).getFullYear();
    let y = years.get(year);
    if (!y) {
      y = { year, count: 0, bytes: 0 };
      years.set(year, y);
    }
    y.count += 1;
    y.bytes += b;
  }

  const largest = photos
    .filter((p) => usable(p) && (p.bytes || 0) > 0)
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
    .slice(0, topN);

  return {
    total,
    photos: pics,
    videos: vids,
    byYear: [...years.values()].sort((a, b) => b.year - a.year),
    largest,
  };
}

export interface DuplicateGroup {
  key: string;
  photos: PhotoRecord[]; // newest first; keep one, the rest are reclaimable
  /** Bytes reclaimable if all but one copy is removed. */
  wastedBytes: number;
}

/** Hamming distance between two equal-length hex perceptual hashes (dHash). */
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Refine size-based candidate groups with perceptual hashes: split each group
 * into sub-groups whose dHashes are within `maxDist`, dropping coincidental
 * byte-size collisions (different images that happen to share size+dimensions).
 * `hashes` maps photoId → dHash hex; photos without a hash are kept together
 * (can't disprove them). Returns real duplicate sets (≥2), largest waste first.
 */
export function refineDuplicates(
  groups: DuplicateGroup[],
  hashes: Map<string, string>,
  maxDist = 6,
): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];
  for (const g of groups) {
    const buckets: PhotoRecord[][] = [];
    for (const p of g.photos) {
      const h = hashes.get(p.id);
      let placed = false;
      if (h) {
        for (const b of buckets) {
          const bh = hashes.get(b[0]!.id);
          if (!bh || hammingHex(h, bh) <= maxDist) {
            b.push(p);
            placed = true;
            break;
          }
        }
      } else if (buckets.length) {
        buckets[0]!.push(p); // unknown hash → keep with the first bucket
        placed = true;
      }
      if (!placed) buckets.push([p]);
    }
    for (const b of buckets) {
      if (b.length < 2) continue;
      b.sort((a, c) => Date.parse(c.createdAt) - Date.parse(a.createdAt));
      out.push({ key: b[0]!.id, photos: b, wastedBytes: (b.length - 1) * (b[0]!.bytes || 0) });
    }
  }
  return out.sort((a, b) => b.wastedBytes - a.wastedBytes);
}

/**
 * Find likely-duplicate sets: photos that share an identical byte size AND pixel
 * dimensions AND media type are, in practice, the same file (re-imported, copied
 * across devices, or double-backed-up). Cheap and false-positive-resistant
 * without any server-side hashing.
 */
export function findDuplicateGroups(photos: PhotoRecord[]): DuplicateGroup[] {
  const byKey = new Map<string, PhotoRecord[]>();
  for (const p of photos) {
    if (!usable(p) || !(p.bytes > 0) || !p.width || !p.height) continue;
    const key = `${p.bytes}|${p.width}x${p.height}|${p.mediaType}`;
    const arr = byKey.get(key);
    if (arr) arr.push(p);
    else byKey.set(key, [p]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, arr] of byKey) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    groups.push({ key, photos: arr, wastedBytes: (arr.length - 1) * (arr[0]!.bytes || 0) });
  }
  return groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
}
