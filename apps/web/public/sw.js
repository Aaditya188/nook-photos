/**
 * Nook Photos service worker — a deliberately small one.
 *
 * - Hashed bundles (/assets/*) and icons: cache-first (they're immutable).
 * - Navigations (index.html): network-first with cache fallback, so the app
 *   shell opens even when the server is briefly unreachable.
 * - /api/* and media: never intercepted — auth, freshness, and Range
 *   streaming stay the server's business.
 *
 * Hard rule: never cache (or serve) an /assets/* response that came back as
 * HTML. That only happens when the server answers a missing bundle with the
 * SPA shell; caching it cache-first would pin the app to a broken bundle until
 * storage is cleared. Bumping the cache version evicts any such poisoned entry.
 */
const SHELL_CACHE = 'nook-shell-v2';
const ASSET_CACHE = 'nook-assets-v2';

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add('/').catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // never touch the API/media

  // Immutable static assets: cache-first — but only ever cache/serve a real
  // asset. An HTML body here means the bundle is missing and the server fell
  // back to the SPA shell; bypass the cache so we never pin a broken build.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit && !isHtml(hit)) return hit;
        const res = await fetch(event.request);
        if (res.ok && !isHtml(res)) cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  // App-shell navigations: network-first, cached fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            caches.open(SHELL_CACHE).then((c) => c.put('/', res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
  }
});
