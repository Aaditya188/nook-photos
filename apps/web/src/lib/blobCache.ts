/**
 * Authed blob-URL LRU cache, ported from the vanilla dashboard.
 *
 * <img>/<video> can't send an Authorization header, so images are fetched with
 * auth and turned into object URLs. Map insertion order doubles as recency
 * (touched entries are re-inserted); evicted entries get their URL revoked.
 * Failed fetches resolve null and drop out of the cache so a later render
 * retries. Blobs are per-user, so signing out flushes the whole cache.
 *
 * Concurrency is capped: a large grid firing hundreds of authed loads at once
 * trips Chrome's ERR_INSUFFICIENT_RESOURCES.
 */

const BLOB_CACHE_CAP = 800;
const MAX_IMG_FETCHES = 10;

type HeaderFn = () => Record<string, string>;
type UnauthorizedFn = () => void;

let headerFn: HeaderFn = () => ({});
let unauthorizedFn: UnauthorizedFn = () => {};

/** Wire the cache to the auth context (called once from the provider). */
export function configureBlobCache(headers: HeaderFn, onUnauthorized: UnauthorizedFn) {
  headerFn = headers;
  unauthorizedFn = onUnauthorized;
}

const blobCache = new Map<string, Promise<string | null>>();

interface FetchJob {
  url: string;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
  /** Return false once the requester is gone — the job is skipped, not fetched. */
  wanted?: () => boolean;
}

let imgFetchActive = 0;
const priorityQueue: FetchJob[] = []; // the open viewer — FIFO, always first
const gridQueue: FetchJob[] = []; // grid thumbnails — LIFO: newest visible wins

/**
 * Grid jobs run newest-first and stale ones (tiles recycled away during a
 * fast fling) are dropped without ever hitting the network — landing at the
 * bottom of the library no longer waits behind hundreds of thumbs you
 * scrolled past.
 */
function pumpImgQueue() {
  while (imgFetchActive < MAX_IMG_FETCHES && (priorityQueue.length || gridQueue.length)) {
    const job = priorityQueue.shift() ?? gridQueue.pop()!;
    if (job.wanted && !job.wanted()) {
      job.reject(new Error('stale'));
      continue;
    }
    imgFetchActive += 1;
    fetch(job.url, { headers: headerFn() })
      .then(job.resolve, job.reject)
      .finally(() => {
        imgFetchActive -= 1;
        pumpImgQueue();
      });
  }
}

function queuedImgFetch(url: string, priority: boolean, wanted?: () => boolean): Promise<Response> {
  return new Promise((resolve, reject) => {
    const job: FetchJob = { url, resolve, reject, wanted };
    if (priority) priorityQueue.push(job);
    else gridQueue.push(job);
    pumpImgQueue();
  });
}

export function getBlobUrl(
  key: string,
  url: string,
  opts: { priority?: boolean; wanted?: () => boolean } = {},
): Promise<string | null> {
  const hit = blobCache.get(key);
  if (hit) {
    blobCache.delete(key);
    blobCache.set(key, hit); // refresh recency
    return hit;
  }
  const entry: Promise<string | null> = queuedImgFetch(url, !!opts.priority, opts.wanted)
    .then((res) => {
      if (res.status === 401) {
        unauthorizedFn();
        throw new Error('unauthorized');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => {
      if (blobCache.get(key) === entry) blobCache.delete(key);
      return null;
    });
  blobCache.set(key, entry);
  while (blobCache.size > BLOB_CACHE_CAP) {
    const oldestKey = blobCache.keys().next().value as string;
    const oldest = blobCache.get(oldestKey)!;
    blobCache.delete(oldestKey);
    oldest.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  }
  return entry;
}

/** Drop every cached render of one photo (after an edit/revert). */
export function flushPhotoBlobs(photoId: string) {
  for (const key of [...blobCache.keys()]) {
    const body = key.slice(key.indexOf(':') + 1);
    if (body === photoId || body.startsWith(photoId + ':')) {
      const entry = blobCache.get(key)!;
      blobCache.delete(key);
      entry.then((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    }
  }
}

export function flushBlobCache() {
  for (const entry of blobCache.values()) {
    entry.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  }
  blobCache.clear();
}
