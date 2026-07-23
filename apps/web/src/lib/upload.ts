/**
 * Web upload engine. Turns dropped/selected files — loose images & videos,
 * folders, or Google Takeout .zip archives — into server photos, reusing the
 * same contract as the mobile backup: POST /api/photos (idempotent per
 * localIdentifier) → PUT thumb (canvas-generated) → PUT original.
 *
 * Metadata precedence: EXIF (JPEG) → Takeout JSON sidecar → file.lastModified.
 * Everything runs client-side; concurrency is capped so a big drop doesn't
 * saturate the browser.
 */
import type { NookClient, PhotoUpload } from '@nook/core';
import { readExif } from './exif';
import { extractEntry, readZipEntries, type ZipEntry } from './unzip';

export interface UploadItem {
  /** Bytes + name; a getter so zip entries inflate lazily. */
  name: string;
  size: number;
  type: string;
  lastModified: number;
  getBlob: () => Promise<Blob>;
  /** Optional Takeout sidecar for this item. */
  sidecar?: () => Promise<TakeoutSidecar | null>;
}

interface TakeoutSidecar {
  photoTakenTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
}

export interface UploadProgress {
  total: number;
  done: number;
  ok: number;
  failed: number;
  current: string;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;

function isImage(name: string, type: string) {
  return type.startsWith('image/') || IMAGE_RE.test(name);
}
function isVideo(name: string, type: string) {
  return type.startsWith('video/') || VIDEO_RE.test(name);
}

/** Flatten a drop / file-input / zip into a list of uploadable items. */
export async function collectItems(files: File[]): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      items.push(...(await collectFromZip(f)));
    } else if (isImage(f.name, f.type) || isVideo(f.name, f.type)) {
      items.push({
        name: f.name,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
        getBlob: async () => f,
      });
    }
  }
  return items;
}

async function collectFromZip(zip: File): Promise<UploadItem[]> {
  const entries = await readZipEntries(zip);
  const byName = new Map<string, ZipEntry>();
  for (const e of entries) byName.set(e.name, e);

  const items: UploadItem[] = [];
  for (const e of entries) {
    const base = e.name.split('/').pop() || e.name;
    if (!base || e.name.endsWith('/')) continue;
    if (!isImage(base, '') && !isVideo(base, '')) continue;

    // Takeout sidecars: "<file>.json" or "<file>.supplemental-metadata.json".
    const sidecarEntry =
      byName.get(e.name + '.json') ||
      byName.get(e.name + '.supplemental-metadata.json') ||
      entries.find((x) => x.name.startsWith(e.name) && x.name.endsWith('.json'));

    items.push({
      name: base,
      size: e.uncompressedSize,
      type: '',
      lastModified: Date.now(),
      getBlob: async () => new Blob([(await extractEntry(zip, e)) as BlobPart]),
      sidecar: sidecarEntry
        ? async () => {
            try {
              const txt = new TextDecoder().decode(await extractEntry(zip, sidecarEntry));
              return JSON.parse(txt) as TakeoutSidecar;
            } catch {
              return null;
            }
          }
        : undefined,
    });
  }
  return items;
}

/** Decode image dimensions in-browser. */
async function imageDimensions(blob: Blob): Promise<{ w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const dim = { w: bmp.width, h: bmp.height };
    bmp.close();
    return dim;
  } catch {
    return null;
  }
}

/** A JPEG thumbnail (<=1024px) via canvas; null for formats we can't decode. */
async function makeThumb(blob: Blob): Promise<{ data: Blob; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    const full = { fullW: bmp.width, fullH: bmp.height };
    bmp.close();
    const data = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!data) return null;
    return { data, w: full.fullW, h: full.fullH };
  } catch {
    return null;
  }
}

/** Video poster frame + dimensions via a hidden <video>. */
async function videoThumb(blob: Blob): Promise<{ data: Blob; w: number; h: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3);
    };
    v.onseeked = () => {
      const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        return resolve(null);
      }
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((data) => {
        cleanup();
        resolve(data ? { data, w: v.videoWidth, h: v.videoHeight, duration: v.duration || 0 } : null);
      }, 'image/jpeg', 0.82);
    };
    v.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}

async function uploadOne(client: NookClient, item: UploadItem): Promise<void> {
  const blob = await item.getBlob();
  const image = isImage(item.name, item.type);
  const localIdentifier = 'web:' + item.name + ':' + item.size + ':' + item.lastModified;

  // Metadata: EXIF → sidecar → mtime.
  let createdAt = new Date(item.lastModified || Date.now()).toISOString();
  let latitude: number | null = null;
  let longitude: number | null = null;
  let width = 0;
  let height = 0;
  let duration: number | null = null;
  let thumb: Blob | null = null;

  if (image) {
    const [exif, thumbRes] = await Promise.all([readExif(blob as File), makeThumb(blob)]);
    if (exif.takenAt) createdAt = exif.takenAt;
    if (exif.latitude != null) latitude = exif.latitude;
    if (exif.longitude != null) longitude = exif.longitude;
    if (thumbRes) {
      thumb = thumbRes.data;
      width = thumbRes.w;
      height = thumbRes.h;
    } else {
      const dim = await imageDimensions(blob);
      if (dim) {
        width = dim.w;
        height = dim.h;
      }
    }
  } else {
    const vt = await videoThumb(blob);
    if (vt) {
      thumb = vt.data;
      width = vt.w;
      height = vt.h;
      duration = vt.duration;
    }
  }

  // Takeout sidecar overrides date/GPS when present (authoritative).
  if (item.sidecar) {
    const sc = await item.sidecar();
    const ts = sc?.photoTakenTime?.timestamp;
    if (ts && /^\d+$/.test(ts)) createdAt = new Date(Number(ts) * 1000).toISOString();
    if (sc?.geoData?.latitude) latitude = sc.geoData.latitude;
    if (sc?.geoData?.longitude) longitude = sc.geoData.longitude;
  }

  const meta: PhotoUpload = {
    localIdentifier,
    filename: item.name,
    createdAt,
    width,
    height,
    bytes: blob.size,
    mediaType: image ? 'photo' : 'video',
    duration,
    latitude,
    longitude,
  };

  const record = await client.createPhoto(meta);

  if (thumb) {
    await fetch(client.url('/api/photos/' + record.id + '/thumb'), {
      method: 'PUT',
      headers: { ...client.authHeaders(), 'Content-Type': 'image/jpeg' },
      body: thumb,
    });
  }
  const orig = await fetch(client.url('/api/photos/' + record.id + '/original'), {
    method: 'PUT',
    headers: { ...client.authHeaders(), 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!orig.ok) throw new Error('upload failed: ' + orig.status);
}

const CONCURRENCY = 3;

/** Upload all items, reporting progress; per-item failures are tolerated. */
export async function runUpload(
  client: NookClient,
  items: UploadItem[],
  onProgress: (p: UploadProgress) => void,
): Promise<UploadProgress> {
  const prog: UploadProgress = { total: items.length, done: 0, ok: 0, failed: 0, current: '' };
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const item = items[idx++];
      prog.current = item.name;
      onProgress({ ...prog });
      try {
        await uploadOne(client, item);
        prog.ok += 1;
      } catch {
        prog.failed += 1;
      }
      prog.done += 1;
      onProgress({ ...prog });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return prog;
}
