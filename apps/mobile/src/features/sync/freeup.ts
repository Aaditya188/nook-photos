/**
 * Free up space: remove local copies of photos/videos that are VERIFIED
 * backed up — present on the server with uploadState 'complete', matched by
 * localIdentifier. The reclaimable size is computed from the server's byte
 * counts (no slow per-asset stat on device). Deletion goes through
 * MediaLibrary.deleteAssetsAsync, which shows the OS's own confirmation
 * dialog — a second safety gate on top of ours.
 */
import * as MediaLibrary from 'expo-media-library/legacy';
import type { NookClient } from '@nook/core';

export interface FreeableScan {
  assetIds: string[];
  count: number;
  bytes: number;
}

export async function scanFreeable(client: NookClient): Promise<FreeableScan> {
  const perm = await MediaLibrary.requestPermissionsAsync(false);
  if (perm.status !== 'granted' && (perm as { accessPrivileges?: string }).accessPrivileges !== 'limited') {
    throw new Error('Photo access denied — enable it in Settings.');
  }

  // Verified-backed-up map: localIdentifier -> server byte size.
  const { photos } = await client.library();
  const verified = new Map<string, number>();
  for (const p of photos) {
    if (p.uploadState === 'complete' && p.localIdentifier) {
      verified.set(p.localIdentifier, p.bytes || 0);
    }
  }

  // Enumerate device assets and keep those the server verifiably holds.
  const assetIds: string[] = [];
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 500,
      after: cursor,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    });
    for (const a of page.assets) {
      if (verified.has(a.id)) {
        assetIds.push(a.id);
        bytes += verified.get(a.id) || 0;
      }
    }
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  return { assetIds, count: assetIds.length, bytes };
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
