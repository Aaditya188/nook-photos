/**
 * Free up space: remove local copies of photos/videos that are VERIFIED
 * backed up — present on the server with uploadState 'complete', matched by
 * localIdentifier. The reclaimable size is computed from the server's byte
 * counts (no slow per-asset stat on device). Deletion goes through
 * MediaLibrary.deleteAssetsAsync, which shows the OS's own confirmation
 * dialog — a second safety gate on top of ours.
 */
import * as MediaLibrary from 'expo-media-library';
import type { NookClient } from '@nook/core';

export interface FreeableScan {
  assetIds: string[];
  count: number;
  bytes: number;
  /** True when iOS granted access to a hand-picked subset, so this scan saw only those. */
  partialAccess: boolean;
  /** Assets the server claims but whose dimensions disagree — skipped, never deleted. */
  mismatched: number;
}

/** What the server verifiably holds, keyed by the device's localIdentifier. */
interface Backed {
  bytes: number;
  width: number;
  height: number;
}

/**
 * Build the verified-backed-up map. `/api/library` already excludes soft-deleted
 * photos, so anything still in the trash can never be mistaken for a safe backup.
 */
export async function backedUpByLocalId(client: NookClient): Promise<Map<string, Backed>> {
  const { photos } = await client.library();
  const verified = new Map<string, Backed>();
  for (const p of photos) {
    if (p.uploadState === 'complete' && p.localIdentifier) {
      verified.set(p.localIdentifier, {
        bytes: p.bytes || 0,
        width: p.width || 0,
        height: p.height || 0,
      });
    }
  }
  return verified;
}

/**
 * Cheap integrity check before we delete someone's only local copy. The Asset from
 * getAssetsAsync carries width/height for free, so comparing them costs nothing —
 * unlike a per-asset getAssetInfoAsync stat, which is far too slow over thousands of
 * items. A dimension disagreement means the localIdentifier matched the wrong asset
 * (or the server holds something else), so we leave that one alone.
 */
function dimensionsAgree(a: MediaLibrary.Asset, b: Backed): boolean {
  if (!b.width || !b.height || !a.width || !a.height) return true; // nothing to compare
  const same = a.width === b.width && a.height === b.height;
  const rotated = a.width === b.height && a.height === b.width; // EXIF orientation
  return same || rotated;
}

export async function scanFreeable(client: NookClient): Promise<FreeableScan> {
  const perm = await MediaLibrary.requestPermissionsAsync(false);
  const privileges = (perm as { accessPrivileges?: string }).accessPrivileges;
  if (perm.status !== 'granted' && privileges !== 'limited') {
    throw new Error('Photo access denied — enable it in Settings.');
  }
  // With limited access iOS only exposes the photos the user hand-picked, so the scan
  // can only ever see a subset. Report it rather than quietly under-counting.
  const partialAccess = privileges === 'limited';

  const verified = await backedUpByLocalId(client);

  // Enumerate device assets and keep those the server verifiably holds.
  const assetIds: string[] = [];
  let bytes = 0;
  let mismatched = 0;
  let cursor: string | undefined;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 500,
      after: cursor,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    });
    for (const a of page.assets) {
      const b = verified.get(a.id);
      if (!b) continue;
      if (!dimensionsAgree(a, b)) {
        mismatched++;
        continue;
      }
      assetIds.push(a.id);
      bytes += b.bytes;
    }
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  return { assetIds, count: assetIds.length, bytes, partialAccess, mismatched };
}

/**
 * Delete the scanned assets from the device. Returns true when the OS dialog
 * was accepted and deletion went through.
 */
export async function freeUpSpace(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return false;
  try {
    return await MediaLibrary.deleteAssetsAsync(assetIds);
  } catch {
    return false;
  }
}
