/**
 * Device → server backup engine (port of the Swift SyncEngine).
 *
 * Enumerates the device library, diffs it against what the server already has,
 * and for each new asset uploads metadata → a client-generated thumbnail → the
 * original bytes. Per-asset failures are tolerated; the pass is resumable because
 * completed uploads are skipped via the server-library diff.
 *
 * Expo Go note: this runs in the foreground (and while foregrounded). True
 * background-while-closed backup needs a dev/EAS build; the preference is stored
 * and honored there.
 */
import * as MediaLibrary from 'expo-media-library/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { NookClient, PhotoUpload } from '@nook/core';

export type BackupPhase =
  | { state: 'idle' }
  | { state: 'permission' }
  | { state: 'permission-denied' }
  | { state: 'scanning' }
  | { state: 'uploading'; done: number; total: number; uploaded: number; failed: number }
  | { state: 'done'; uploaded: number; failed: number }
  | { state: 'error'; message: string };

export interface BackupPrefs {
  wifiOnly: boolean;
  originalQuality: boolean;
}

export interface BackupHandle {
  onPhase: (p: BackupPhase) => void;
  isCancelled: () => boolean;
}

const MAX_VIDEO_BYTES = 480 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  gif: 'image/gif', webp: 'image/webp', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4',
};

function contentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

async function withRetries<T>(attempts: number, op: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw last;
}

export async function runBackup(client: NookClient, prefs: BackupPrefs, handle: BackupHandle): Promise<void> {
  handle.onPhase({ state: 'permission' });
  const perm = await MediaLibrary.requestPermissionsAsync(false);
  if (perm.status !== 'granted' && (perm as any).accessPrivileges !== 'limited') {
    handle.onPhase({ state: 'permission-denied' });
    return;
  }

  handle.onPhase({ state: 'scanning' });

  // Build the skip set from the server (fully-uploaded + recently-deleted).
  let skip = new Set<string>();
  try {
    const [{ photos }, deleted] = await Promise.all([
      withRetries(3, () => client.library()),
      client.deleted().catch(() => ({ photos: [] })),
    ]);
    skip = new Set([
      ...photos.filter((p) => p.uploadState === 'complete').map((p) => p.localIdentifier),
      ...deleted.photos.map((p) => p.localIdentifier),
    ]);
  } catch (e) {
    handle.onPhase({ state: 'error', message: e instanceof Error ? e.message : 'Could not reach server' });
    return;
  }

  // Enumerate all device assets, newest first.
  const assets: MediaLibrary.Asset[] = [];
  let cursor: string | undefined;
  do {
    if (handle.isCancelled()) return;
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after: cursor,
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    });
    assets.push(...page.assets);
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  const remaining = assets.filter((a) => !skip.has(a.id));
  const total = remaining.length;
  let uploaded = 0;
  let failed = 0;
  handle.onPhase({ state: 'uploading', done: 0, total, uploaded, failed });

  for (let i = 0; i < remaining.length; i++) {
    if (handle.isCancelled()) {
      handle.onPhase({ state: 'idle' });
      return;
    }
    try {
      await backupAsset(client, remaining[i]!, prefs);
      uploaded++;
    } catch {
      failed++;
    }
    handle.onPhase({ state: 'uploading', done: i + 1, total, uploaded, failed });
  }

  handle.onPhase({ state: 'done', uploaded, failed });
}

async function backupAsset(client: NookClient, asset: MediaLibrary.Asset, prefs: BackupPrefs): Promise<void> {
  const isVideo = asset.mediaType === MediaLibrary.MediaType.video;
  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
  const localUri = info.localUri ?? asset.uri;
  const filename = asset.filename || `IMG_${asset.id.slice(0, 8)}`;
  const exif = (info.exif ?? {}) as Record<string, any>;

  const meta: PhotoUpload = {
    localIdentifier: asset.id,
    filename,
    createdAt: new Date(asset.creationTime).toISOString(),
    width: asset.width,
    height: asset.height,
    bytes: 0,
    mediaType: isVideo ? 'video' : 'photo',
    duration: isVideo ? asset.duration : null,
    latitude: info.location?.latitude ?? exif?.GPSLatitude ?? null,
    longitude: info.location?.longitude ?? exif?.GPSLongitude ?? null,
    cameraMake: exif?.['{TIFF}']?.Make ?? exif?.Make ?? null,
    cameraModel: exif?.['{TIFF}']?.Model ?? exif?.Model ?? null,
    lensModel: exif?.['{Exif}']?.LensModel ?? exif?.LensModel ?? null,
    fNumber: exif?.['{Exif}']?.FNumber ?? exif?.FNumber ?? null,
    focalLength: exif?.['{Exif}']?.FocalLength ?? exif?.FocalLength ?? null,
    iso: exif?.['{Exif}']?.ISOSpeedRatings?.[0] ?? exif?.ISOSpeedRatings?.[0] ?? null,
    exposureTime: exif?.['{Exif}']?.ExposureTime ?? exif?.ExposureTime ?? null,
  };

  const record = await client.createPhoto(meta);

  // Client-generated thumbnail (matches the Swift app). For videos we grab a
  // poster frame so grid tiles/viewer show an image, not a placeholder.
  if (localUri) {
    try {
      let thumbUri: string;
      if (isVideo) {
        const shot = await VideoThumbnails.getThumbnailAsync(localUri, { time: 1000, quality: 0.7 });
        thumbUri = shot.uri;
      } else {
        const manipulated = await ImageManipulator.manipulateAsync(
          localUri,
          [{ resize: { width: 1024 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
        );
        thumbUri = manipulated.uri;
      }
      await FileSystem.uploadAsync(client.url(`/api/photos/${record.id}/thumb`), thumbUri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { ...client.authHeaders(), 'Content-Type': 'image/jpeg' },
      });
    } catch {
      // non-fatal: a missing thumb just shows a placeholder
    }
  }

  // Original bytes.
  if (localUri) {
    if (isVideo) {
      const stat = await FileSystem.getInfoAsync(localUri);
      if (!stat.exists || ((stat as { size?: number }).size ?? 0) > MAX_VIDEO_BYTES) return; // oversize → leave pending
    }
    await FileSystem.uploadAsync(client.url(`/api/photos/${record.id}/original`), localUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...client.authHeaders(), 'Content-Type': contentType(filename) },
    });
  }
}
