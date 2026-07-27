# `apps/server`, the performance gateway

Fastify + [sharp](https://sharp.pixelplumbing.com/) in front of the origin store. Everything a
browser or phone talks to goes through here on **port 8090**; the origin (`apps/origin`, port 8080)
is never exposed directly.

It exists because the origin is deliberately zero-dependency and therefore can't resize an image,
seek a video, or decode HEIC. This is where those live.

## What it does

| Job | Detail |
|---|---|
| **Sized thumbnails** | `?w=128…1024` buckets, resized on demand and cached to disk. The grid asks for exactly the pixel size it renders (zoom level × devicePixelRatio), so it never downloads a 4 MP original for a 180 px tile. |
| **Range streaming** | HTTP-Range for video and originals, so seeking never pulls the whole file. |
| **HEIC → JPEG** | iPhone HEIC decoded server-side for browsers that can't display it. |
| **Non-destructive edits** | Edit *recipes* (rotate / straighten / flip / crop / light / colour) stored in `edits.json` and re-applied by sharp at every render size. Originals are never modified; deleting the recipe reverts instantly. See [`src/edits.ts`](src/edits.ts). |
| **Static hosting** | Serves the built dashboard from `apps/web/dist`. |
| **Transparent proxy** | Everything else is streamed to the origin unchanged. |
| **Login rate limiting** | [`src/ratelimit.ts`](src/ratelimit.ts). |

## Layout

```
src/index.ts      routes, static hosting, proxy, logging
src/thumbs.ts     sharp pipeline + on-disk size cache (applies edit recipes)
src/edits.ts      edit recipe store, validation, and the sharp application order
src/shares.ts     public share links
src/ratelimit.ts  login throttling
src/db.ts         token lookup against the origin's store
src/config.ts     env + paths
```

## Running it

```bash
npm run build -w @nook/web                  # the dashboard must be built first
cd apps/server && ../../node_modules/.bin/tsx src/index.ts
```

Then open <http://localhost:8090>. For an always-on install, `install-gateway-service.ps1`
registers it as a Windows service.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NOOK_GATEWAY_PORT` | `8090` | listen port |
| `NOOK_ORIGIN` | `http://127.0.0.1:8080` | origin base URL |
| `NOOK_WEB_DIST` |, | serve the dashboard from a custom directory |
| `NOOK_DATA_DIR` |, | where caches and `edits.json` live |
| `LOG_LEVEL` | `info` | pino level |

**There is no fallback dashboard.** If no build is found, `/` 404s, the API keeps working, and
startup logs a loud warning telling you to run the build. A second unmaintained UI silently
standing in for the real one is worse than an honest 404.

## Gotchas

- **Media auth accepts `?token=`.** `<img>` and `<video>` can't send an `Authorization` header, so
  media requests may carry the token in the query string. The request logger **redacts** it
  (`redactUrl` in `src/index.ts`), never remove that, and never add a second place that logs a raw
  URL. Authed media responses are `Cache-Control: private` so a CDN edge can't store them.
- **The `'*'` content parser doesn't cover JSON.** The gateway registers a passthrough parser so
  uploads stream through unparsed, but Fastify's built-in JSON parser still handles
  `application/json`, a route handler may receive **an object or a stream**.
- **sharp on Windows may lack HEIF**, so HEIC decoding goes through `heic-convert` in
  [`src/thumbs.ts`](src/thumbs.ts) rather than sharp.
- **Edit recipe order matters** and mirrors the client preview exactly: EXIF auto-orient → rotate →
  straighten (with inscribed auto-crop) → flips → crop → light/colour/effects. The recipe's
  timestamp is folded into cache filenames so a stale render can't be served.
